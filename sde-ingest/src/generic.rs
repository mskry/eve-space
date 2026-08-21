use crate::{db, zip_stream};
use anyhow::{Context, Result};
use postgres::Transaction;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs::File;
use zip::ZipArchive;

/// The datasets handled by `typed.rs`; everything else falls through to the
/// generic `sde_dataset_rows` catch-all so the ingestion covers all 102 SDE
/// datasets without hand-designed schema for the ~90 this app doesn't query
/// relationally today.
const TYPED_MEMBERS: &[&str] = &[
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
    // Build metadata, not a game dataset — same content as latest.jsonl.
    "_sde.jsonl",
];

pub fn generic_members(archive: &ZipArchive<File>) -> Vec<String> {
    let excluded: BTreeSet<&str> = TYPED_MEMBERS.iter().copied().collect();
    archive
        .file_names()
        .filter(|name| name.ends_with(".jsonl") && !excluded.contains(name))
        .map(str::to_owned)
        .collect()
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

pub fn ingest_member(archive: &mut ZipArchive<File>, client: &mut Transaction, member: &str) -> Result<u64> {
    let dataset = member.trim_end_matches(".jsonl").to_string();
    let lines = zip_stream::lines(archive, member)?;
    let rows = lines.map(move |line| {
        let line = line?;
        let value: Value = serde_json::from_str(&line)?;
        let key = key_text(&value)
            .with_context(|| format!("{dataset} row is missing a usable _key"))?;
        Ok(vec![db::text(&dataset), db::text(&key), db::text(&value.to_string())])
    });
    db::copy_rows(client, "sde_dataset_rows", &["dataset", "key", "data"], rows)
}
