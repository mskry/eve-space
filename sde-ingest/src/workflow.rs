use crate::db::{self, BuildProjection};
use crate::feed::{LatestBuild, OfficialSdeSource, SdeSource};
use crate::projection::{INGEST_PROJECTION_VERSION, IngestProgress, IngestReport, import_archive};
use anyhow::Result;
use std::path::Path;
use std::time::Duration;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IngestOutcome {
    Unchanged {
        projection: BuildProjection,
    },
    Imported {
        projection: BuildProjection,
        report: IngestReport,
    },
}

pub struct SdeIngestor {
    source: Box<dyn SdeSource>,
    store: Box<dyn ProjectionStore>,
    progress: Box<dyn IngestProgress>,
}

impl SdeIngestor {
    pub fn connect(database_url: &str) -> Result<Self> {
        Ok(Self {
            source: Box::new(OfficialSdeSource::new()?),
            store: Box::new(PostgresProjectionStore {
                client: db::connect(database_url)?,
            }),
            progress: Box::new(ConsoleProgress),
        })
    }

    pub fn run(&mut self) -> Result<IngestOutcome> {
        self.progress.checking_latest();
        let latest = self.source.latest_build()?;
        let projection = BuildProjection {
            build_number: latest.build_number,
            ingest_version: INGEST_PROJECTION_VERSION,
        };
        let current = self.store.latest_projection()?;
        if !db::needs_ingest(current, projection.build_number, projection.ingest_version) {
            return Ok(IngestOutcome::Unchanged { projection });
        }

        self.progress.ingest_required(current, projection);
        let archive = self.source.acquire_archive(latest.build_number)?;
        let report = self
            .store
            .import_archive(&archive, &latest, self.progress.as_mut())?;
        self.source.release_archive(&archive);
        Ok(IngestOutcome::Imported { projection, report })
    }
}

trait ProjectionStore {
    fn latest_projection(&mut self) -> Result<Option<BuildProjection>>;
    fn import_archive(
        &mut self,
        archive: &Path,
        build: &LatestBuild,
        progress: &mut dyn IngestProgress,
    ) -> Result<IngestReport>;
}

struct PostgresProjectionStore {
    client: postgres::Client,
}

impl ProjectionStore for PostgresProjectionStore {
    fn latest_projection(&mut self) -> Result<Option<BuildProjection>> {
        db::latest_build_projection(&mut self.client)
    }

    fn import_archive(
        &mut self,
        archive: &Path,
        build: &LatestBuild,
        progress: &mut dyn IngestProgress,
    ) -> Result<IngestReport> {
        import_archive(
            &mut self.client,
            archive,
            build.build_number,
            build.release_date,
            progress,
        )
    }
}

struct ConsoleProgress;

impl IngestProgress for ConsoleProgress {
    fn checking_latest(&mut self) {
        println!("Checking the latest EVE SDE build...");
    }

    fn ingest_required(&mut self, current: Option<BuildProjection>, target: BuildProjection) {
        match current {
            Some(current) if current.build_number == target.build_number => println!(
                "Local SDE build {} uses projection version {}; reloading projection version {}.",
                current.build_number, current.ingest_version, target.ingest_version
            ),
            Some(current) => println!(
                "Local build {} is behind the latest build {}.",
                current.build_number, target.build_number
            ),
            None => println!("No SDE build ingested yet."),
        }
    }

    fn replacing_projection(&mut self) {
        println!("Truncating SDE tables...");
    }

    fn dataset_imported(&mut self, dataset: &str, rows: u64, elapsed: Duration) {
        println!("  {dataset}: {rows} rows ({:.1}s)", elapsed.as_secs_f64());
    }

    fn dataset_skipped(&mut self, dataset: &str, error: &anyhow::Error) {
        eprintln!("  {dataset}: skipped ({error:#})");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::{DatasetImport, SkippedDataset};
    use anyhow::anyhow;
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::rc::Rc;
    use time::OffsetDateTime;

    #[derive(Default)]
    struct SourceState {
        acquired: Vec<i64>,
        released: Vec<PathBuf>,
    }

    struct FixtureSource {
        latest: LatestBuild,
        archive: PathBuf,
        state: Rc<RefCell<SourceState>>,
    }

    impl SdeSource for FixtureSource {
        fn latest_build(&mut self) -> Result<LatestBuild> {
            Ok(self.latest)
        }

        fn acquire_archive(&mut self, build_number: i64) -> Result<PathBuf> {
            self.state.borrow_mut().acquired.push(build_number);
            Ok(self.archive.clone())
        }

        fn release_archive(&mut self, archive: &Path) {
            self.state.borrow_mut().released.push(archive.to_owned());
        }
    }

    struct FixtureStore {
        current: Option<BuildProjection>,
        report: Option<Result<IngestReport>>,
        imported: Rc<RefCell<Vec<PathBuf>>>,
    }

    impl ProjectionStore for FixtureStore {
        fn latest_projection(&mut self) -> Result<Option<BuildProjection>> {
            Ok(self.current)
        }

        fn import_archive(
            &mut self,
            archive: &Path,
            _build: &LatestBuild,
            _progress: &mut dyn IngestProgress,
        ) -> Result<IngestReport> {
            self.imported.borrow_mut().push(archive.to_owned());
            self.report.take().expect("fixture import result")
        }
    }

    #[derive(Default)]
    struct SilentProgress;

    impl IngestProgress for SilentProgress {
        fn checking_latest(&mut self) {}
        fn ingest_required(&mut self, _current: Option<BuildProjection>, _target: BuildProjection) {
        }
        fn replacing_projection(&mut self) {}
        fn dataset_imported(&mut self, _dataset: &str, _rows: u64, _elapsed: Duration) {}
        fn dataset_skipped(&mut self, _dataset: &str, _error: &anyhow::Error) {}
    }

    #[test]
    fn matching_build_and_projection_skips_archive_acquisition() {
        let projection = projection(1234);
        let source_state = Rc::new(RefCell::new(SourceState::default()));
        let imported = Rc::new(RefCell::new(Vec::new()));
        let mut ingestor = fixture_ingestor(
            Some(projection),
            Ok(empty_report()),
            source_state.clone(),
            imported.clone(),
        );

        assert_eq!(
            ingestor.run().unwrap(),
            IngestOutcome::Unchanged { projection }
        );
        assert!(source_state.borrow().acquired.is_empty());
        assert!(imported.borrow().is_empty());
    }

    #[test]
    fn imported_outcome_reports_optional_failures_and_releases_the_archive() {
        let source_state = Rc::new(RefCell::new(SourceState::default()));
        let imported = Rc::new(RefCell::new(Vec::new()));
        let report = IngestReport {
            imported: vec![DatasetImport {
                dataset: "types".to_owned(),
                rows: 2,
            }],
            skipped: vec![SkippedDataset {
                dataset: "optional.jsonl".to_owned(),
                error: "invalid row".to_owned(),
            }],
        };
        let mut ingestor = fixture_ingestor(
            Some(BuildProjection {
                build_number: 1234,
                ingest_version: INGEST_PROJECTION_VERSION - 1,
            }),
            Ok(report.clone()),
            source_state.clone(),
            imported.clone(),
        );

        assert_eq!(
            ingestor.run().unwrap(),
            IngestOutcome::Imported {
                projection: projection(1234),
                report,
            }
        );
        assert_eq!(source_state.borrow().acquired, vec![1234]);
        assert_eq!(
            source_state.borrow().released,
            vec![PathBuf::from("fixture.zip")]
        );
        assert_eq!(*imported.borrow(), vec![PathBuf::from("fixture.zip")]);
    }

    #[test]
    fn failed_publication_keeps_the_archive_for_retry() {
        let source_state = Rc::new(RefCell::new(SourceState::default()));
        let mut ingestor = fixture_ingestor(
            None,
            Err(anyhow!("projection failed")),
            source_state.clone(),
            Rc::new(RefCell::new(Vec::new())),
        );

        assert_eq!(ingestor.run().unwrap_err().to_string(), "projection failed");
        assert!(source_state.borrow().released.is_empty());
    }

    fn fixture_ingestor(
        current: Option<BuildProjection>,
        report: Result<IngestReport>,
        source_state: Rc<RefCell<SourceState>>,
        imported: Rc<RefCell<Vec<PathBuf>>>,
    ) -> SdeIngestor {
        SdeIngestor {
            source: Box::new(FixtureSource {
                latest: LatestBuild {
                    build_number: 1234,
                    release_date: OffsetDateTime::UNIX_EPOCH,
                },
                archive: PathBuf::from("fixture.zip"),
                state: source_state,
            }),
            store: Box::new(FixtureStore {
                current,
                report: Some(report),
                imported,
            }),
            progress: Box::new(SilentProgress),
        }
    }

    fn projection(build_number: i64) -> BuildProjection {
        BuildProjection {
            build_number,
            ingest_version: INGEST_PROJECTION_VERSION,
        }
    }

    fn empty_report() -> IngestReport {
        IngestReport {
            imported: Vec::new(),
            skipped: Vec::new(),
        }
    }
}
