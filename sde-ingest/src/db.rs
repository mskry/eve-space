use anyhow::{Context, Result};
use postgres::{Client, NoTls, Transaction};
use std::io::Write;
use time::OffsetDateTime;

const RECORD_BUILD_SQL: &str =
    "insert into sde_builds (build_number, release_date, ingest_version) values ($1, $2, $3)
     on conflict (build_number) do update set
       release_date = excluded.release_date,
       ingest_version = excluded.ingest_version,
       ingested_at = now()";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BuildProjection {
    pub build_number: i64,
    pub ingest_version: i32,
}

pub fn connect(database_url: &str) -> Result<Client> {
    Client::connect(database_url, NoTls).context("connecting to Postgres")
}

pub fn latest_build_projection(client: &mut Client) -> Result<Option<BuildProjection>> {
    let row = client
        .query_opt(
            "select build_number, ingest_version
             from sde_builds
             order by build_number desc
             limit 1",
            &[],
        )
        .context("reading latest ingested SDE build")?;
    Ok(row.map(|row| BuildProjection {
        build_number: row.get("build_number"),
        ingest_version: row.get("ingest_version"),
    }))
}

pub fn needs_ingest(
    current: Option<BuildProjection>,
    build_number: i64,
    ingest_version: i32,
) -> bool {
    current
        != Some(BuildProjection {
            build_number,
            ingest_version,
        })
}

pub fn record_build(
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
    Ok(())
}

pub fn truncate_all(client: &mut Transaction) -> Result<()> {
    client
        .batch_execute(
            "truncate table
                sde_categories, sde_groups, sde_types, sde_market_groups,
                sde_dogma_attributes, sde_dogma_effects,
                sde_type_dogma_attributes, sde_type_dogma_effects,
                sde_races, sde_bloodlines, sde_ancestries, sde_factions,
                sde_dataset_rows",
        )
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
    use super::{BuildProjection, RECORD_BUILD_SQL, needs_ingest, opt_text, text};

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
    fn ingest_decision_requires_both_build_and_projection_version_to_match() {
        let current = BuildProjection {
            build_number: 1234,
            ingest_version: 2,
        };

        assert!(!needs_ingest(Some(current), 1234, 2));
        assert!(needs_ingest(Some(current), 1235, 2));
        assert!(needs_ingest(Some(current), 1234, 3));
        assert!(needs_ingest(None, 1234, 2));
    }

    #[test]
    fn build_record_upsert_updates_the_completed_projection() {
        assert!(RECORD_BUILD_SQL.contains("ingest_version = excluded.ingest_version"));
        assert!(RECORD_BUILD_SQL.contains("ingested_at = now()"));
    }
}
