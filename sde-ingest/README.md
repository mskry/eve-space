# SDE ingestion

Run database migrations first, then run `pnpm sde:ingest` from the repository root. The importer reads `DATABASE_URL` from the root `.env` and downloads the latest official JSONL SDE. Deployment instructions are in [docs/railway.md](../docs/railway.md).

The command delegates the complete workflow to `SdeIngestor::run()`. A current or newer active projection returns an unchanged outcome without acquiring the archive. A completed reload returns row counts and any optional raw datasets that were skipped. Required projections, raw-retention policy, table replacement, build history, and the active marker are owned by one projection plan and publish in one PostgreSQL transaction.

Projection version 4 retains version 3's `sde_solar_systems` and `sde_npc_stations` typed location projections. Version 3 requires migration `041_sde_locations.sql`. Version 4 requires the raw `mapSolarSystems.jsonl` and `mapStargates.jsonl` datasets in `sde_dataset_rows`; serialized publication additionally requires migration `044_sde_projection_state.sql`. A newer build or same-build projection upgrade reloads the complete projection. Older builds and same-build projection downgrades cannot replace the active projection.

All typed projections and both routing datasets are required. Missing, empty, invalid, or unpersistable required data aborts the transaction and preserves the previous committed projection and active marker. Other raw JSONL members use independent savepoints and may be reported as skipped without aborting publication. Raw `npcStations.jsonl` is therefore attempted as optional generic retention, while `sde_npc_stations` remains mandatory.

If a required import fails after acquiring the archive, fix the database, migration, or projection error and rerun the same command. The completed archive remains as `eve-sde-<build>.zip` in the operating system's temporary directory and is reused. Downloads first write a `.zip.part` sibling, so an interrupted download is never reused as a complete archive. If the retained ZIP itself is unreadable or corrupt, delete it before rerunning to force a fresh download. Successful publication performs best-effort cleanup of current and stale ZIP and partial files.

Asset security enrichment reads the local station and system projections through the process-local snapshot. It does not issue individual ESI station or system requests. Missing static locations retain null security; player-owned structures are outside this static projection. Station names continue through the existing batched universe-name lookup because the official SDE generally stores the components of a station name rather than a ready-to-display name.

The API lazily loads the complete public location and universe-topology projections into each process. Their revision is the full `(build_number, ingest_version, ingested_at)` tuple, including the database timestamp's full precision. Active processes check the committed marker on the first applicable request after each one-minute interval; unchanged revisions do not reload a snapshot, and idle processes do not poll.

Supported projection updates must lock `sde_projection_state`, re-read its active `sde_builds` record, replace their tables, record history, and advance the active pointer in the same ingestion transaction. Static locations retain their last valid snapshot through revision-read and replacement failures. Routing retains a warm topology when its revision cannot be checked, but fails closed if a newer revision is known and its replacement cannot be loaded. Cold consumers remain unavailable until a complete projection can be loaded. Manual projection repairs require a corresponding committed active-marker update or an API process restart. The skill catalogue remains process-lifetime state, so restart all API processes after an ingest that changes published skills.

## Local verification

Run from the repository root:

```bash
cargo fmt --manifest-path sde-ingest/Cargo.toml --all --check
cargo clippy --manifest-path sde-ingest/Cargo.toml --all-targets --all-features --locked -- -D warnings
cargo test --manifest-path sde-ingest/Cargo.toml --all-features --locked
pnpm --filter @eve-space/api test:postgres
```
