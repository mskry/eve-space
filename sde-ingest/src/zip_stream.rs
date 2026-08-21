use anyhow::{Context, Result};
use std::fs::File;
use std::io::{BufRead, BufReader};
use zip::ZipArchive;

/// Streams one zip member line-by-line without ever materializing the full
/// decompressed file in memory — required for members like `types.jsonl`
/// (152 MB) and `mapMoons.jsonl` (224 MB).
pub fn lines<'a>(
    archive: &'a mut ZipArchive<File>,
    member: &'a str,
) -> Result<impl Iterator<Item = Result<String>> + 'a> {
    let file = archive
        .by_name(member)
        .with_context(|| format!("SDE archive is missing member {member}"))?;
    let reader = BufReader::new(file);
    Ok(reader
        .lines()
        .map(move |line| line.with_context(|| format!("reading a line from {member}")))
        .filter(|line| !matches!(line, Ok(text) if text.trim().is_empty())))
}
