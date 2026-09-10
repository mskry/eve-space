use crate::{db, generic, locations, typed};
use anyhow::{Context, Result, ensure};
use postgres::Transaction;
use std::fs::File;
use std::time::{Duration, Instant};
use time::OffsetDateTime;
use zip::ZipArchive;

pub const INGEST_PROJECTION_VERSION: i32 = 4;

type DatasetIngestFn = fn(&mut ZipArchive<File>, &mut Transaction) -> Result<u64>;

const REQUIRED_DATASETS: &[RequiredDataset] = &[
    RequiredDataset::Single("categories", typed::ingest_categories),
    RequiredDataset::Single("groups", typed::ingest_groups),
    RequiredDataset::Single("types", typed::ingest_types),
    RequiredDataset::Single("market groups", typed::ingest_market_groups),
    RequiredDataset::Single("dogma attributes", typed::ingest_dogma_attributes),
    RequiredDataset::Single("dogma effects", typed::ingest_dogma_effects),
    RequiredDataset::Single("solar systems", locations::ingest_solar_systems),
    RequiredDataset::Single("NPC stations", locations::ingest_npc_stations),
    RequiredDataset::TypeDogma,
    RequiredDataset::Single("races", typed::ingest_races),
    RequiredDataset::Single("bloodlines", typed::ingest_bloodlines),
    RequiredDataset::Single("ancestries", typed::ingest_ancestries),
    RequiredDataset::Single("factions", typed::ingest_factions),
];

const RAW_EXCLUDED_MEMBERS: &[&str] = &[
    "categories.jsonl",
    "groups.jsonl",
    "types.jsonl",
    "marketGroups.jsonl",
    "dogmaAttributes.jsonl",
    "dogmaEffects.jsonl",
    "typeDogma.jsonl",
    "races.jsonl",
    "bloodlines.jsonl",
    "ancestries.jsonl",
    "factions.jsonl",
    "_sde.jsonl",
];

const REQUIRED_RAW_MEMBERS: &[&str] = &["mapSolarSystems.jsonl", "mapStargates.jsonl"];

const REPLACED_TABLES: &[&str] = &[
    "sde_categories",
    "sde_groups",
    "sde_types",
    "sde_market_groups",
    "sde_dogma_attributes",
    "sde_dogma_effects",
    "sde_type_dogma_attributes",
    "sde_type_dogma_effects",
    "sde_races",
    "sde_bloodlines",
    "sde_ancestries",
    "sde_factions",
    "sde_dataset_rows",
    "sde_npc_stations",
    "sde_solar_systems",
];

enum RequiredDataset {
    Single(&'static str, DatasetIngestFn),
    TypeDogma,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DatasetImport {
    pub dataset: String,
    pub rows: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SkippedDataset {
    pub dataset: String,
    pub error: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IngestReport {
    pub imported: Vec<DatasetImport>,
    pub skipped: Vec<SkippedDataset>,
}

pub(crate) trait IngestProgress {
    fn checking_latest(&mut self);
    fn ingest_required(
        &mut self,
        current: Option<db::BuildProjection>,
        target: db::BuildProjection,
    );
    fn replacing_projection(&mut self);
    fn dataset_imported(&mut self, dataset: &str, rows: u64, elapsed: Duration);
    fn dataset_skipped(&mut self, dataset: &str, error: &anyhow::Error);
}

pub(crate) fn import_archive(
    client: &mut postgres::Client,
    archive_path: &std::path::Path,
    build_number: i64,
    release_date: OffsetDateTime,
    progress: &mut dyn IngestProgress,
) -> Result<IngestReport> {
    let file = std::fs::File::open(archive_path)
        .with_context(|| format!("opening {}", archive_path.display()))?;
    let mut archive = ZipArchive::new(file).context("reading the SDE zip")?;
    let mut transaction = client
        .transaction()
        .context("starting the SDE ingest transaction")?;

    progress.replacing_projection();
    db::truncate_all(&mut transaction, REPLACED_TABLES)?;

    let mut report = IngestReport {
        imported: Vec::new(),
        skipped: Vec::new(),
    };
    for dataset in REQUIRED_DATASETS {
        import_required_dataset(
            dataset,
            &mut archive,
            &mut transaction,
            &mut report,
            progress,
        )?;
    }
    for member in REQUIRED_RAW_MEMBERS {
        let started = Instant::now();
        let rows = generic::ingest_member(&mut archive, &mut transaction, member)
            .with_context(|| format!("ingesting required raw dataset {member}"))?;
        ensure!(rows > 0, "required raw dataset {member} is empty");
        record_import(&mut report, progress, member, rows, started.elapsed());
    }

    let optional_members =
        generic::optional_members(&archive, RAW_EXCLUDED_MEMBERS, REQUIRED_RAW_MEMBERS);
    for member in optional_members {
        let started = Instant::now();
        let mut savepoint = transaction
            .transaction()
            .with_context(|| format!("starting a savepoint for {member}"))?;
        match generic::ingest_member(&mut archive, &mut savepoint, &member) {
            Ok(rows) => {
                savepoint
                    .commit()
                    .with_context(|| format!("committing {member}"))?;
                record_import(&mut report, progress, &member, rows, started.elapsed());
            }
            Err(error) => {
                progress.dataset_skipped(&member, &error);
                report.skipped.push(SkippedDataset {
                    dataset: member,
                    error: format!("{error:#}"),
                });
            }
        }
    }

    db::record_build(
        &mut transaction,
        build_number,
        release_date,
        INGEST_PROJECTION_VERSION,
    )?;
    transaction
        .commit()
        .context("committing the SDE ingest transaction")?;
    Ok(report)
}

fn import_required_dataset(
    dataset: &RequiredDataset,
    archive: &mut ZipArchive<File>,
    transaction: &mut Transaction,
    report: &mut IngestReport,
    progress: &mut dyn IngestProgress,
) -> Result<()> {
    let started = Instant::now();
    match dataset {
        RequiredDataset::Single(label, ingest) => {
            let rows =
                ingest(archive, transaction).with_context(|| format!("ingesting {label}"))?;
            ensure!(rows > 0, "required dataset {label} is empty");
            record_import(report, progress, label, rows, started.elapsed());
        }
        RequiredDataset::TypeDogma => {
            let (attribute_rows, effect_rows) =
                typed::ingest_type_dogma(archive, transaction).context("ingesting type dogma")?;
            ensure!(
                attribute_rows > 0 && effect_rows > 0,
                "required type dogma projection is empty"
            );
            let elapsed = started.elapsed();
            record_import(
                report,
                progress,
                "type dogma attributes",
                attribute_rows,
                elapsed,
            );
            record_import(report, progress, "type dogma effects", effect_rows, elapsed);
        }
    }
    Ok(())
}

fn record_import(
    report: &mut IngestReport,
    progress: &mut dyn IngestProgress,
    dataset: &str,
    rows: u64,
    elapsed: Duration,
) {
    progress.dataset_imported(dataset, rows, elapsed);
    report.imported.push(DatasetImport {
        dataset: dataset.to_owned(),
        rows,
    });
}

#[cfg(test)]
mod tests {
    use super::{RAW_EXCLUDED_MEMBERS, REPLACED_TABLES, REQUIRED_RAW_MEMBERS};

    #[test]
    fn raw_dataset_policy_preserves_required_and_location_sources() {
        assert!(REQUIRED_RAW_MEMBERS.contains(&"mapSolarSystems.jsonl"));
        assert!(REQUIRED_RAW_MEMBERS.contains(&"mapStargates.jsonl"));
        assert!(!RAW_EXCLUDED_MEMBERS.contains(&"npcStations.jsonl"));
        assert!(REPLACED_TABLES.contains(&"sde_dataset_rows"));
        assert!(REPLACED_TABLES.contains(&"sde_solar_systems"));
        assert!(REPLACED_TABLES.contains(&"sde_npc_stations"));
    }
}
