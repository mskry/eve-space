use anyhow::{Context, Result};
use serde::Deserialize;
use std::fs::File;
use std::io::copy;
use std::path::Path;
use std::path::PathBuf;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

const LATEST_URL: &str = "https://developers.eveonline.com/static-data/tranquility/latest.jsonl";

#[derive(Clone, Copy, Debug)]
pub(crate) struct LatestBuild {
    pub build_number: i64,
    pub release_date: OffsetDateTime,
}

#[derive(Deserialize)]
struct LatestBuildResponse {
    #[serde(rename = "buildNumber")]
    pub build_number: i64,
    #[serde(rename = "releaseDate")]
    release_date: String,
}

pub(crate) trait SdeSource {
    fn latest_build(&mut self) -> Result<LatestBuild>;
    fn acquire_archive(&mut self, build_number: i64) -> Result<PathBuf>;
    fn release_archive(&mut self, archive: &Path);
}

pub(crate) struct OfficialSdeSource {
    client: reqwest::blocking::Client,
    download_directory: PathBuf,
}

impl OfficialSdeSource {
    pub(crate) fn new() -> Result<Self> {
        Ok(Self {
            client: reqwest::blocking::Client::builder()
                .user_agent("eve-space-sde-ingest/0.1")
                .build()
                .context("building the HTTP client")?,
            download_directory: std::env::temp_dir(),
        })
    }
}

impl SdeSource for OfficialSdeSource {
    fn latest_build(&mut self) -> Result<LatestBuild> {
        let latest = self
            .client
            .get(LATEST_URL)
            .send()
            .context("requesting the latest SDE build number")?
            .error_for_status()
            .context("CCP's latest-build endpoint returned an error")?
            .json::<LatestBuildResponse>()
            .context("parsing latest.jsonl")?;
        Ok(LatestBuild {
            build_number: latest.build_number,
            release_date: OffsetDateTime::parse(&latest.release_date, &Rfc3339)
                .context("parsing the SDE release date")?,
        })
    }

    fn acquire_archive(&mut self, build_number: i64) -> Result<PathBuf> {
        let destination = self
            .download_directory
            .join(format!("eve-sde-{build_number}.zip"));
        if destination.exists() {
            println!(
                "Reusing already-downloaded archive at {}.",
                destination.display()
            );
        } else {
            println!("Downloading SDE build {build_number} (~94 MB)...");
            download_build(&self.client, build_number, &destination)?;
        }
        Ok(destination)
    }

    fn release_archive(&mut self, archive: &Path) {
        cleanup_downloads(&self.download_directory, archive);
    }
}

/// Streams the SDE zip to a `.part` sibling and renames it into place, so a killed download never
/// leaves a truncated file at `destination` for a later run to mistake for a complete archive.
fn download_build(
    client: &reqwest::blocking::Client,
    build_number: i64,
    destination: &Path,
) -> Result<()> {
    let url = format!(
        "https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-{build_number}-jsonl.zip"
    );
    let mut response = client
        .get(&url)
        .send()
        .with_context(|| format!("downloading SDE build {build_number}"))?
        .error_for_status()
        .with_context(|| format!("SDE build {build_number} download returned an error"))?;

    let mut temp_path = destination.as_os_str().to_owned();
    temp_path.push(".part");
    let temp_path = Path::new(&temp_path);

    let mut file =
        File::create(temp_path).with_context(|| format!("creating {}", temp_path.display()))?;
    copy(&mut response, &mut file).context("writing the downloaded SDE zip to disk")?;
    drop(file);

    std::fs::rename(temp_path, destination).with_context(|| {
        format!(
            "moving downloaded archive into place at {}",
            destination.display()
        )
    })?;
    Ok(())
}

fn cleanup_downloads(directory: &Path, current: &Path) {
    let _ = std::fs::remove_file(current);
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with("eve-sde-") && (name.ends_with(".zip") || name.ends_with(".zip.part")) {
            let _ = std::fs::remove_file(path);
        }
    }
}
