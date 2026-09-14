use anyhow::{Context, Result, ensure};
use postgres::{Client, GenericClient, NoTls, Transaction};
use std::io::Write;
use time::OffsetDateTime;

const RECORD_BUILD_SQL: &str =
    "insert into sde_builds (build_number, release_date, ingest_version) values ($1, $2, $3)
     on conflict (build_number) do update set
       release_date = excluded.release_date,
       ingest_version = excluded.ingest_version,
       ingested_at = now()";

const ACTIVATE_BUILD_SQL: &str =
    "update sde_projection_state set active_build_number = $1 where singleton = true";

const ACTIVE_PROJECTION_SQL: &str = "select builds.build_number, builds.ingest_version
     from sde_projection_state as state
     left join sde_builds as builds on builds.build_number = state.active_build_number
     where state.singleton = true";

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct BuildProjection {
    pub build_number: i64,
    pub ingest_version: i32,
}

pub fn connect(database_url: &str) -> Result<Client> {
    Client::connect(database_url, NoTls).context("connecting to Postgres")
}

pub fn latest_build_projection(client: &mut Client) -> Result<Option<BuildProjection>> {
    active_projection(client)
}

pub fn lock_active_projection(transaction: &mut Transaction) -> Result<Option<BuildProjection>> {
    transaction
        .query_one(
            "select singleton
             from sde_projection_state
             where singleton = true
             for update",
            &[],
        )
        .context("acquiring SDE publication ownership")?;
    active_projection(transaction)
}

pub fn needs_ingest(
    current: Option<BuildProjection>,
    build_number: i64,
    ingest_version: i32,
) -> bool {
    let candidate = BuildProjection {
        build_number,
        ingest_version,
    };
    current.is_none_or(|current| candidate > current)
}

pub fn record_publication(
    client: &mut Transaction,
    build_number: i64,
    release_date: OffsetDateTime,
    ingest_version: i32,
) -> Result<()> {
    client
        .execute(
            RECORD_BUILD_SQL,
            &[&build_number, &release_date, &ingest_version],
        )
        .context("recording ingested SDE build")?;
    let updated = client
        .execute(ACTIVATE_BUILD_SQL, &[&build_number])
        .context("activating ingested SDE build")?;
    ensure!(updated == 1, "SDE projection state row is missing");
    Ok(())
}

fn active_projection(client: &mut impl GenericClient) -> Result<Option<BuildProjection>> {
    let row = client
        .query_one(ACTIVE_PROJECTION_SQL, &[])
        .context("reading active SDE projection")?;
    let Some(build_number) = row.get::<_, Option<i64>>("build_number") else {
        return Ok(None);
    };
    let ingest_version = row
        .get::<_, Option<i32>>("ingest_version")
        .context("active SDE build is missing its projection version")?;
    Ok(Some(BuildProjection {
        build_number,
        ingest_version,
    }))
}

pub fn truncate_all(client: &mut Transaction, tables: &[&str]) -> Result<()> {
    let statement = format!("truncate table {}", tables.join(", "));
    client
        .batch_execute(&statement)
        .context("truncating SDE tables before reload")
}

/// Bulk-loads rows via Postgres text-format `COPY FROM STDIN` — the standard
/// high-throughput bulk load path (same mechanism `pg_restore` uses), far
/// faster than row-by-row INSERTs at this volume (types.jsonl alone is
/// ~53k rows).
pub fn copy_rows<I>(client: &mut Transaction, table: &str, columns: &[&str], rows: I) -> Result<u64>
where
    I: Iterator<Item = Result<Vec<String>>>,
{
    let statement = format!("COPY {table} ({}) FROM STDIN", columns.join(", "));
    let mut writer = client
        .copy_in(&statement)
        .with_context(|| format!("starting COPY into {table}"))?;
    let mut count = 0u64;

    for fields in rows {
        let fields = fields.with_context(|| format!("parsing a row for {table}"))?;
        writeln!(writer, "{}", fields.join("\t"))
            .with_context(|| format!("writing a row to {table}"))?;
        count += 1;
    }

    writer
        .finish()
        .with_context(|| format!("finishing COPY into {table}"))?;
    Ok(count)
}

pub fn text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '\t' => escaped.push_str("\\t"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            other => escaped.push(other),
        }
    }
    escaped
}

pub fn opt_text(value: Option<&str>) -> String {
    match value {
        Some(value) => text(value),
        None => "\\N".to_string(),
    }
}

pub fn num<T: std::fmt::Display>(value: T) -> String {
    value.to_string()
}

pub fn opt_num<T: std::fmt::Display>(value: Option<T>) -> String {
    match value {
        Some(value) => value.to_string(),
        None => "\\N".to_string(),
    }
}

pub fn boolean(value: bool) -> String {
    if value {
        "t".to_string()
    } else {
        "f".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ACTIVATE_BUILD_SQL, BuildProjection, RECORD_BUILD_SQL, needs_ingest, opt_text, text,
    };

    #[test]
    fn copy_text_escapes_postgres_control_characters_and_nulls() {
        assert_eq!(
            text("raw\\value\tline\nreturn\r"),
            "raw\\\\value\\tline\\nreturn\\r"
        );
        assert_eq!(opt_text(None), "\\N");
        assert_eq!(opt_text(Some("\\N")), "\\\\N");
    }

    #[test]
    fn ingest_decision_only_accepts_a_newer_projection() {
        let current = BuildProjection {
            build_number: 1234,
            ingest_version: 2,
        };

        assert!(!needs_ingest(Some(current), 1234, 2));
        assert!(!needs_ingest(Some(current), 1234, 1));
        assert!(!needs_ingest(Some(current), 1233, 3));
        assert!(needs_ingest(Some(current), 1235, 2));
        assert!(needs_ingest(Some(current), 1234, 3));
        assert!(needs_ingest(None, 1234, 2));
    }

    #[test]
    fn build_record_upsert_updates_the_completed_projection() {
        assert!(RECORD_BUILD_SQL.contains("ingest_version = excluded.ingest_version"));
        assert!(RECORD_BUILD_SQL.contains("ingested_at = now()"));
        assert!(ACTIVATE_BUILD_SQL.contains("active_build_number = $1"));
    }
}
