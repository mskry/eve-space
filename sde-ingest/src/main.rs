use anyhow::{Context, Result};
use sde_ingest::{IngestOutcome, SdeIngestor};
use std::path::Path;

fn main() -> Result<()> {
    load_env();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let mut ingestor = SdeIngestor::connect(&database_url)?;

    match ingestor.run()? {
        IngestOutcome::Unchanged { projection } => println!(
            "Already at the latest SDE build and projection ({}). Nothing to do.",
            projection.build_number
        ),
        IngestOutcome::Imported { projection, report } => {
            println!("Ingested SDE build {}.", projection.build_number);
            if !report.skipped.is_empty() {
                println!(
                    "Completed with {} optional datasets skipped.",
                    report.skipped.len()
                );
            }
        }
    }
    Ok(())
}

fn load_env() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let root_env = Path::new(manifest_dir).join("..").join(".env");
    let _ = dotenvy::from_path(root_env);
}
