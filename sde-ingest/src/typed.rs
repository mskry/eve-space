use crate::model::LocalizedText;
use crate::{db, zip_stream};
use anyhow::Result;
use postgres::Transaction;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::fs::File;
use zip::ZipArchive;

/// Parses each JSONL line as `T` and converts it to one output row.
fn map_lines<T, F>(
    lines: impl Iterator<Item = Result<String>>,
    mut to_row: F,
) -> impl Iterator<Item = Result<Vec<String>>>
where
    T: DeserializeOwned,
    F: FnMut(T) -> Vec<String>,
{
    lines.map(move |line| {
        let line = line?;
        let parsed: T = serde_json::from_str(&line)?;
        Ok(to_row(parsed))
    })
}

#[derive(Deserialize)]
struct RawCategory {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(default)]
    name: LocalizedText,
    published: bool,
}

pub fn ingest_categories(archive: &mut ZipArchive<File>, client: &mut Transaction) -> Result<u64> {
    let lines = zip_stream::lines(archive, "categories.jsonl")?;
    let rows = map_lines::<RawCategory, _>(lines, |raw| {
        vec![
            db::num(raw.key),
            db::text(&raw.name.into_text()),
            db::boolean(raw.published),
        ]
    });
    db::copy_rows(
        client,
        "sde_categories",
        &["category_id", "name", "published"],
        rows,
    )
}

#[derive(Deserialize)]
struct RawGroup {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(rename = "categoryID")]
    category_id: i64,
    #[serde(default)]
    name: LocalizedText,
    published: bool,
}

pub fn ingest_groups(archive: &mut ZipArchive<File>, client: &mut Transaction) -> Result<u64> {
    let lines = zip_stream::lines(archive, "groups.jsonl")?;
    let rows = map_lines::<RawGroup, _>(lines, |raw| {
        vec![
            db::num(raw.key),
            db::num(raw.category_id),
            db::text(&raw.name.into_text()),
            db::boolean(raw.published),
        ]
    });
    db::copy_rows(
        client,
        "sde_groups",
        &["group_id", "category_id", "name", "published"],
        rows,
    )
}

#[derive(Deserialize)]
struct RawType {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(rename = "groupID")]
    group_id: i64,
    #[serde(rename = "raceID")]
    race_id: Option<i64>,
    #[serde(rename = "marketGroupID")]
    market_group_id: Option<i64>,
    #[serde(default)]
    name: LocalizedText,
    #[serde(default)]
    description: Option<LocalizedText>,
    published: bool,
    mass: Option<f64>,
    volume: Option<f64>,
    capacity: Option<f64>,
    #[serde(rename = "portionSize")]
    portion_size: Option<i64>,
    #[serde(rename = "basePrice")]
    base_price: Option<f64>,
}

fn type_row(raw: RawType) -> Vec<String> {
    let description = raw.description.and_then(LocalizedText::into_optional_text);
    vec![
        db::num(raw.key),
        db::num(raw.group_id),
        db::opt_num(raw.race_id),
        db::opt_num(raw.market_group_id),
        db::text(&raw.name.into_text()),
        db::opt_text(description.as_deref()),
        db::boolean(raw.published),
        db::opt_num(raw.mass),
        db::opt_num(raw.volume),
        db::opt_num(raw.capacity),
        db::opt_num(raw.portion_size),
        db::opt_num(raw.base_price),
    ]
}

pub fn ingest_types(archive: &mut ZipArchive<File>, client: &mut Transaction) -> Result<u64> {
    let lines = zip_stream::lines(archive, "types.jsonl")?;
    let rows = map_lines::<RawType, _>(lines, type_row);
    db::copy_rows(
        client,
        "sde_types",
        &[
            "type_id",
            "group_id",
            "race_id",
            "market_group_id",
            "name",
            "description",
            "published",
            "mass",
            "volume",
            "capacity",
            "portion_size",
            "base_price",
        ],
        rows,
    )
}

#[derive(Deserialize)]
struct RawMarketGroup {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(rename = "parentGroupID")]
    parent_group_id: Option<i64>,
    #[serde(default)]
    name: LocalizedText,
    #[serde(default)]
    description: Option<LocalizedText>,
}

pub fn ingest_market_groups(
    archive: &mut ZipArchive<File>,
    client: &mut Transaction,
) -> Result<u64> {
    let lines = zip_stream::lines(archive, "marketGroups.jsonl")?;
    let rows = map_lines::<RawMarketGroup, _>(lines, |raw| {
        vec![
            db::num(raw.key),
            db::opt_num(raw.parent_group_id),
            db::text(&raw.name.into_text()),
            db::opt_text(raw.description.map(LocalizedText::into_text).as_deref()),
        ]
    });
    db::copy_rows(
        client,
        "sde_market_groups",
        &["market_group_id", "parent_group_id", "name", "description"],
        rows,
    )
}

#[derive(Deserialize)]
struct RawDogmaAttribute {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(default)]
    name: String,
    description: Option<String>,
    #[serde(rename = "defaultValue")]
    default_value: Option<f64>,
    published: bool,
    #[serde(rename = "highIsGood")]
    high_is_good: bool,
    stackable: bool,
}

pub fn ingest_dogma_attributes(
    archive: &mut ZipArchive<File>,
    client: &mut Transaction,
) -> Result<u64> {
    let lines = zip_stream::lines(archive, "dogmaAttributes.jsonl")?;
    let rows = map_lines::<RawDogmaAttribute, _>(lines, |raw| {
        vec![
            db::num(raw.key),
            db::text(&raw.name),
            db::opt_text(raw.description.as_deref()),
            db::opt_num(raw.default_value),
            db::boolean(raw.published),
            db::boolean(raw.high_is_good),
            db::boolean(raw.stackable),
        ]
    });
    db::copy_rows(
        client,
        "sde_dogma_attributes",
        &[
            "attribute_id",
            "name",
            "description",
            "default_value",
            "published",
            "high_is_good",
            "stackable",
        ],
        rows,
    )
}

#[derive(Deserialize)]
struct RawDogmaEffect {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(default)]
    name: String,
    #[serde(rename = "effectCategoryID")]
    effect_category_id: i64,
    published: bool,
    #[serde(rename = "isOffensive")]
    is_offensive: bool,
    #[serde(rename = "isAssistance")]
    is_assistance: bool,
    #[serde(rename = "isWarpSafe")]
    is_warp_safe: bool,
}

pub fn ingest_dogma_effects(
    archive: &mut ZipArchive<File>,
    client: &mut Transaction,
) -> Result<u64> {
    let lines = zip_stream::lines(archive, "dogmaEffects.jsonl")?;
    let rows = map_lines::<RawDogmaEffect, _>(lines, |raw| {
        vec![
            db::num(raw.key),
            db::text(&raw.name),
            db::num(raw.effect_category_id),
            db::boolean(raw.published),
            db::boolean(raw.is_offensive),
            db::boolean(raw.is_assistance),
            db::boolean(raw.is_warp_safe),
        ]
    });
    db::copy_rows(
        client,
        "sde_dogma_effects",
        &[
            "effect_id",
            "name",
            "effect_category_id",
            "published",
            "is_offensive",
            "is_assistance",
            "is_warp_safe",
        ],
        rows,
    )
}

#[derive(Deserialize)]
struct RawTypeDogmaAttribute {
    #[serde(rename = "attributeID")]
    attribute_id: i64,
    value: f64,
}

#[derive(Deserialize)]
struct RawTypeDogmaEffect {
    #[serde(rename = "effectID")]
    effect_id: i64,
    #[serde(rename = "isDefault")]
    is_default: bool,
}

#[derive(Deserialize)]
struct RawTypeDogma {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(default, rename = "dogmaAttributes")]
    dogma_attributes: Vec<RawTypeDogmaAttribute>,
    #[serde(default, rename = "dogmaEffects")]
    dogma_effects: Vec<RawTypeDogmaEffect>,
}

/// Reads `typeDogma.jsonl` once and buffers both output tables, since a connection can only run one `COPY` at a time.
pub fn ingest_type_dogma(
    archive: &mut ZipArchive<File>,
    client: &mut Transaction,
) -> Result<(u64, u64)> {
    let mut attribute_rows: Vec<Vec<String>> = Vec::new();
    let mut effect_rows: Vec<Vec<String>> = Vec::new();

    for line in zip_stream::lines(archive, "typeDogma.jsonl")? {
        let raw: RawTypeDogma = serde_json::from_str(&line?)?;
        let type_id = raw.key;
        attribute_rows.extend(raw.dogma_attributes.into_iter().map(|attribute| {
            vec![
                db::num(type_id),
                db::num(attribute.attribute_id),
                db::num(attribute.value),
            ]
        }));
        effect_rows.extend(raw.dogma_effects.into_iter().map(|effect| {
            vec![
                db::num(type_id),
                db::num(effect.effect_id),
                db::boolean(effect.is_default),
            ]
        }));
    }

    let attribute_count = db::copy_rows(
        client,
        "sde_type_dogma_attributes",
        &["type_id", "attribute_id", "value"],
        attribute_rows.into_iter().map(Ok),
    )?;
    let effect_count = db::copy_rows(
        client,
        "sde_type_dogma_effects",
        &["type_id", "effect_id", "is_default"],
        effect_rows.into_iter().map(Ok),
    )?;
    Ok((attribute_count, effect_count))
}

#[derive(Deserialize)]
struct RawRace {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(default)]
    name: LocalizedText,
    #[serde(default)]
    description: Option<LocalizedText>,
}

pub fn ingest_races(archive: &mut ZipArchive<File>, client: &mut Transaction) -> Result<u64> {
    let lines = zip_stream::lines(archive, "races.jsonl")?;
    let rows = map_lines::<RawRace, _>(lines, |raw| {
        vec![
            db::num(raw.key),
            db::text(&raw.name.into_text()),
            db::opt_text(raw.description.map(LocalizedText::into_text).as_deref()),
        ]
    });
    db::copy_rows(
        client,
        "sde_races",
        &["race_id", "name", "description"],
        rows,
    )
}

#[derive(Deserialize)]
struct RawBloodline {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(rename = "raceID")]
    race_id: Option<i64>,
    #[serde(default)]
    name: LocalizedText,
    #[serde(default)]
    description: Option<LocalizedText>,
}

pub fn ingest_bloodlines(archive: &mut ZipArchive<File>, client: &mut Transaction) -> Result<u64> {
    let lines = zip_stream::lines(archive, "bloodlines.jsonl")?;
    let rows = map_lines::<RawBloodline, _>(lines, |raw| {
        vec![
            db::num(raw.key),
            db::opt_num(raw.race_id),
            db::text(&raw.name.into_text()),
            db::opt_text(raw.description.map(LocalizedText::into_text).as_deref()),
        ]
    });
    db::copy_rows(
        client,
        "sde_bloodlines",
        &["bloodline_id", "race_id", "name", "description"],
        rows,
    )
}

#[derive(Deserialize)]
struct RawAncestry {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(rename = "bloodlineID")]
    bloodline_id: Option<i64>,
    #[serde(default)]
    name: LocalizedText,
    #[serde(rename = "shortDescription")]
    short_description: Option<String>,
}

pub fn ingest_ancestries(archive: &mut ZipArchive<File>, client: &mut Transaction) -> Result<u64> {
    let lines = zip_stream::lines(archive, "ancestries.jsonl")?;
    let rows = map_lines::<RawAncestry, _>(lines, |raw| {
        vec![
            db::num(raw.key),
            db::opt_num(raw.bloodline_id),
            db::text(&raw.name.into_text()),
            db::opt_text(raw.short_description.as_deref()),
        ]
    });
    db::copy_rows(
        client,
        "sde_ancestries",
        &["ancestry_id", "bloodline_id", "name", "short_description"],
        rows,
    )
}

#[derive(Deserialize)]
struct RawFaction {
    #[serde(rename = "_key")]
    key: i64,
    #[serde(default)]
    name: LocalizedText,
    #[serde(default)]
    description: Option<LocalizedText>,
}

pub fn ingest_factions(archive: &mut ZipArchive<File>, client: &mut Transaction) -> Result<u64> {
    let lines = zip_stream::lines(archive, "factions.jsonl")?;
    let rows = map_lines::<RawFaction, _>(lines, |raw| {
        vec![
            db::num(raw.key),
            db::text(&raw.name.into_text()),
            db::opt_text(raw.description.map(LocalizedText::into_text).as_deref()),
        ]
    });
    db::copy_rows(
        client,
        "sde_factions",
        &["faction_id", "name", "description"],
        rows,
    )
}

#[cfg(test)]
mod tests {
    use super::{RawType, type_row};

    fn description_field(json: &str) -> String {
        let raw: RawType = serde_json::from_str(json).unwrap();
        type_row(raw)[5].clone()
    }

    #[test]
    fn type_descriptions_are_nullable_and_preserve_raw_markup() {
        assert_eq!(
            description_field(r#"{"_key":1,"groupID":2,"name":{"en":"Name"},"published":true}"#),
            "\\N"
        );
        assert_eq!(
            description_field(
                r#"{"_key":1,"groupID":2,"name":{"en":"Name"},"description":{"en":""},"published":true}"#,
            ),
            "\\N"
        );
        assert_eq!(
            description_field(
                r#"{"_key":1,"groupID":2,"name":{"en":"Name"},"description":{"en":"<b>Raw</b>\ntext"},"published":true}"#,
            ),
            "<b>Raw</b>\\ntext"
        );
    }
}
