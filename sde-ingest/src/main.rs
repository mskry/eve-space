mod db;
mod feed;
mod generic;
mod model;
mod typed;
mod zip_stream;

use anyhow::{Context, Result};
use std::path::Path;
use std::time::Instant;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use zip::ZipArchive;

fn main() -> Result<()> {
    load_env();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;

    let http = reqwest::blocking::Client::builder()
        .user_agent("eve-space-sde-ingest/0.1")
        .build()
        .context("building the HTTP client")?;

    println!("Checking the latest EVE SDE build...");
    let latest = feed::fetch_latest_build(&http)?;

    let mut client = db::connect(&database_url)?;
    if let Some(current) = db::latest_build_number(&mut client)? {
        if current == latest.build_number {
            println!("Already at the latest SDE build ({current}). Nothing to do.");
            return Ok(());
        }
        println!("Local build {current} is behind the latest build {}.", latest.build_number);
    } else {
        println!("No SDE build ingested yet.");
    }

    let zip_path = std::env::temp_dir().join(format!("eve-sde-{}.zip", latest.build_number));
    if zip_path.exists() {
        println!("Reusing already-downloaded archive at {}.", zip_path.display());
    } else {
        println!("Downloading SDE build {} (~94 MB)...", latest.build_number);
        feed::download_build(&http, latest.build_number, &zip_path)?;
    }

    let release_date = OffsetDateTime::parse(&latest.release_date, &Rfc3339)
        .context("parsing the SDE release date")?;
    ingest(&mut client, &zip_path, latest.build_number, release_date)?;

    cleanup_downloads(&zip_path);

    Ok(())
}

/// Also sweeps stale `eve-sde-*` files from prior failed/superseded runs, so temp disk usage doesn't grow unbounded.
fn cleanup_downloads(current: &Path) {
    let _ = std::fs::remove_file(current);

    let dir = std::env::temp_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else { continue };
        if name.starts_with("eve-sde-") && (name.ends_with(".zip") || name.ends_with(".zip.part")) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

type TypedIngestFn = fn(&mut ZipArchive<std::fs::File>, &mut postgres::Transaction) -> Result<u64>;

fn ingest(client: &mut postgres::Client, zip_path: &Path, build_number: i64, release_date: OffsetDateTime) -> Result<()> {
    let file = std::fs::File::open(zip_path).with_context(|| format!("opening {}", zip_path.display()))?;
    let mut archive = ZipArchive::new(file).context("reading the SDE zip")?;

    // One transaction for the whole reload, so a failure partway through leaves the prior build intact.
    let mut tx = client.transaction().context("starting the SDE ingest transaction")?;

    println!("Truncating SDE tables...");
    db::truncate_all(&mut tx)?;

    let typed_datasets: &[(&str, TypedIngestFn)] = &[
        ("categories", typed::ingest_categories),
        ("groups", typed::ingest_groups),
        ("types", typed::ingest_types),
        ("market groups", typed::ingest_market_groups),
        ("dogma attributes", typed::ingest_dogma_attributes),
        ("dogma effects", typed::ingest_dogma_effects),
    ];

    for (label, ingest_fn) in typed_datasets {
        let started = Instant::now();
        let count = ingest_fn(&mut archive, &mut tx)
            .with_context(|| format!("ingesting {label}"))?;
        println!("  {label}: {count} rows ({:.1}s)", started.elapsed().as_secs_f64());
    }

    let started = Instant::now();
    let (attribute_count, effect_count) = typed::ingest_type_dogma(&mut archive, &mut tx)
        .context("ingesting type dogma")?;
    println!(
        "  type dogma attributes: {attribute_count} rows, type dogma effects: {effect_count} rows ({:.1}s)",
        started.elapsed().as_secs_f64()
    );

    let remaining_typed_datasets: &[(&str, TypedIngestFn)] = &[
        ("races", typed::ingest_races),
        ("bloodlines", typed::ingest_bloodlines),
        ("ancestries", typed::ingest_ancestries),
        ("factions", typed::ingest_factions),
    ];

    for (label, ingest_fn) in remaining_typed_datasets {
        let started = Instant::now();
        let count = ingest_fn(&mut archive, &mut tx)
            .with_context(|| format!("ingesting {label}"))?;
        println!("  {label}: {count} rows ({:.1}s)", started.elapsed().as_secs_f64());
    }

    let generic_members = generic::generic_members(&archive);
    println!("Ingesting {} remaining datasets into sde_dataset_rows...", generic_members.len());
    for member in &generic_members {
        let started = Instant::now();
        // A savepoint per member: an aborted COPY only rolls back this dataset, not the whole transaction.
        let mut savepoint = tx
            .transaction()
            .with_context(|| format!("starting a savepoint for {member}"))?;
        match generic::ingest_member(&mut archive, &mut savepoint, member) {
            Ok(count) => {
                savepoint.commit().with_context(|| format!("committing {member}"))?;
                println!("  {member}: {count} rows ({:.1}s)", started.elapsed().as_secs_f64());
            }
            Err(error) => eprintln!("  {member}: skipped ({error:#})"),
        }
    }

    db::record_build(&mut tx, build_number, release_date)?;
    tx.commit().context("committing the SDE ingest transaction")?;
    println!("Ingested SDE build {build_number}.");
    Ok(())
}

fn load_env() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let root_env = Path::new(manifest_dir).join("..").join(".env");
    let _ = dotenvy::from_path(root_env);
}
