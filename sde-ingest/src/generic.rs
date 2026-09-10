use crate::{db, zip_stream};
use anyhow::{Context, Result};
use postgres::Transaction;
use serde_json::Value;
use std::fs::File;
use zip::ZipArchive;

pub fn optional_members(
    archive: &ZipArchive<File>,
    excluded: &[&str],
    required: &[&str],
) -> Vec<String> {
    archive
        .file_names()
        .filter(|name| is_optional_member(name, excluded, required))
        .map(str::to_owned)
        .collect()
}

fn is_optional_member(name: &str, excluded: &[&str], required: &[&str]) -> bool {
    name.ends_with(".jsonl") && !excluded.contains(&name) && !required.contains(&name)
}

/// Most datasets key rows by integer id; a handful (militaryCampaigns,
/// characterTitles, translationLanguages) key by UUID or language-code
/// strings instead — `sde_dataset_rows.key` is text, so either works.
fn key_text(value: &Value) -> Option<String> {
    match value.get("_key")? {
        Value::Number(number) => Some(number.to_string()),
        Value::String(text) => Some(text.clone()),
        _ => None,
    }
}

pub fn ingest_member(
    archive: &mut ZipArchive<File>,
    client: &mut Transaction,
    member: &str,
) -> Result<u64> {
    let dataset = member.trim_end_matches(".jsonl").to_string();
    let lines = zip_stream::lines(archive, member)?;
    let rows = lines.map(move |line| {
        let line = line?;
        let value: Value = serde_json::from_str(&line)?;
        let key =
            key_text(&value).with_context(|| format!("{dataset} row is missing a usable _key"))?;
        Ok(vec![
            db::text(&dataset),
            db::text(&key),
            db::text(&value.to_string()),
        ])
    });
    db::copy_rows(
        client,
        "sde_dataset_rows",
        &["dataset", "key", "data"],
        rows,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn member_classification_honors_the_projection_plan() {
        let excluded = ["types.jsonl"];
        let required = ["mapStargates.jsonl"];
        assert!(!is_optional_member("types.jsonl", &excluded, &required));
        assert!(!is_optional_member(
            "mapStargates.jsonl",
            &excluded,
            &required
        ));
        assert!(is_optional_member("mapRegions.jsonl", &excluded, &required));
    }
}
