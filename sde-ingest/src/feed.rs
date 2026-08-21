use anyhow::{Context, Result};
use serde::Deserialize;
use std::fs::File;
use std::io::copy;
use std::path::Path;

const LATEST_URL: &str = "https://developers.eveonline.com/static-data/tranquility/latest.jsonl";

#[derive(Deserialize)]
pub struct LatestBuild {
    #[serde(rename = "buildNumber")]
    pub build_number: i64,
    #[serde(rename = "releaseDate")]
    pub release_date: String,
}

pub fn fetch_latest_build(client: &reqwest::blocking::Client) -> Result<LatestBuild> {
    client
        .get(LATEST_URL)
        .send()
        .context("requesting the latest SDE build number")?
        .error_for_status()
        .context("CCP's latest-build endpoint returned an error")?
        .json::<LatestBuild>()
        .context("parsing latest.jsonl")
}

/// Streams the SDE zip to a `.part` sibling and renames it into place, so a killed download never
/// leaves a truncated file at `destination` for a later run to mistake for a complete archive.
pub fn download_build(
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

    let mut file = File::create(temp_path)
        .with_context(|| format!("creating {}", temp_path.display()))?;
    copy(&mut response, &mut file).context("writing the downloaded SDE zip to disk")?;
    drop(file);

    std::fs::rename(temp_path, destination)
        .with_context(|| format!("moving downloaded archive into place at {}", destination.display()))?;
    Ok(())
}
