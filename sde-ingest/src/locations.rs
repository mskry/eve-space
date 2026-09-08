use crate::model::LocalizedText;
use crate::{db, zip_stream};
use anyhow::{Result, ensure};
use postgres::Transaction;
use serde::Deserialize;
use std::fs::File;
use zip::ZipArchive;

#[derive(Deserialize)]
struct SolarSystem {
    #[serde(rename = "_key")]
    id: i64,
    name: LocalizedText,
    #[serde(rename = "securityStatus")]
    security_status: f64,
}

#[derive(Deserialize)]
struct NpcStation {
    #[serde(rename = "_key")]
    id: i64,
    #[serde(rename = "solarSystemID")]
    solar_system_id: i64,
}

pub fn ingest_solar_systems(
    archive: &mut ZipArchive<File>,
    client: &mut Transaction,
) -> Result<u64> {
    let rows =
        zip_stream::lines(archive, "mapSolarSystems.jsonl")?.map(|line| solar_system_row(&line?));
    db::copy_rows(
        client,
        "sde_solar_systems",
        &["solar_system_id", "name", "security_status"],
        rows,
    )
}

pub fn ingest_npc_stations(
    archive: &mut ZipArchive<File>,
    client: &mut Transaction,
) -> Result<u64> {
    let rows = zip_stream::lines(archive, "npcStations.jsonl")?.map(|line| npc_station_row(&line?));
    db::copy_rows(
        client,
        "sde_npc_stations",
        &["station_id", "solar_system_id"],
        rows,
    )
}

fn solar_system_row(line: &str) -> Result<Vec<String>> {
    let raw: SolarSystem = serde_json::from_str(line)?;
    ensure!(raw.id > 0, "invalid solar system ID");
    ensure!(
        raw.security_status.is_finite() && (-1.0..=1.0).contains(&raw.security_status),
        "invalid system security"
    );
    let name = raw
        .name
        .into_optional_text()
        .ok_or_else(|| anyhow::anyhow!("missing English solar system name"))?;
    Ok(vec![
        db::num(raw.id),
        db::text(&name),
        db::num(raw.security_status),
    ])
}

fn npc_station_row(line: &str) -> Result<Vec<String>> {
    let raw: NpcStation = serde_json::from_str(line)?;
    ensure!(
        raw.id > 0 && raw.solar_system_id > 0,
        "invalid NPC station location"
    );
    Ok(vec![db::num(raw.id), db::num(raw.solar_system_id)])
}

#[cfg(test)]
mod tests {
    use super::{npc_station_row, solar_system_row};

    #[test]
    fn preserves_true_security_and_projects_station_system_ids() {
        assert_eq!(
            solar_system_row(r#"{"_key":30000142,"name":{"en":"Jita"},"securityStatus":0.945913}"#)
                .unwrap(),
            vec!["30000142", "Jita", "0.945913"]
        );
        assert_eq!(
            solar_system_row(r#"{"_key":30000001,"name":{"en":"Null"},"securityStatus":-0.06}"#)
                .unwrap(),
            vec!["30000001", "Null", "-0.06"]
        );
        assert_eq!(
            npc_station_row(r#"{"_key":60003760,"solarSystemID":30000142,"ownerID":1000035}"#)
                .unwrap(),
            vec!["60003760", "30000142"]
        );
    }

    #[test]
    fn rejects_missing_or_invalid_location_data() {
        assert!(solar_system_row(r#"{"_key":1,"name":{"en":"Jita"}}"#).is_err());
        assert!(solar_system_row(r#"{"_key":1,"name":{"en":"Jita"},"securityStatus":2}"#).is_err());
        assert!(solar_system_row(r#"{"_key":1,"name":{},"securityStatus":0}"#).is_err());
        assert!(npc_station_row(r#"{"_key":60003760}"#).is_err());
        assert!(npc_station_row(r#"{"_key":60003760,"solarSystemID":0}"#).is_err());
    }
}
