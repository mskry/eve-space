# SDE ingestion

Run database migrations first, then run `pnpm sde:ingest` from the repository root. The importer reads `DATABASE_URL` from the root `.env` and downloads the latest official JSONL SDE. Deployment instructions are in [docs/railway.md](../docs/railway.md).

Projection version 3 adds `sde_solar_systems` (English system names and full-precision security status) and `sde_npc_stations` (NPC station IDs and their solar system IDs). It requires migration `041_sde_locations.sql`. A previously ingested SDE build is reloaded when its projection version differs, even if the upstream build has not changed.

These projections are mandatory parts of the existing atomic reload: invalid or missing location data rolls back the transaction and preserves the previous build. The full raw `mapSolarSystems` and `npcStations` datasets remain in `sde_dataset_rows` as well.

Asset security enrichment joins the local station and system projections in one query. It does not issue individual ESI station or system requests. Missing static locations retain null security; player-owned structures are outside this static projection. Station names continue through the existing batched universe-name lookup because the official SDE generally stores the components of a station name rather than a ready-to-display name.

The API lazily loads the complete public location projection into each process. Its revision is the full `(build_number, ingest_version, ingested_at)` tuple, including the database timestamp's full precision. Active processes check that committed marker on the first location request after each one-minute interval; unchanged revisions do not reload the projection, and idle processes do not poll.

Supported projection updates must replace the typed tables and update `sde_builds` in the same ingestion transaction. A changed revision is loaded from one read-only consistent database snapshot and atomically replaces the process-local cache. During a database or ingestion outage, a process retains its last valid public snapshot and retries no more than once per minute. A cold process leaves static enrichment unavailable until a complete projection can be loaded. Manual projection repairs require a corresponding committed marker update or an API process restart.

Run `cargo test --manifest-path sde-ingest/Cargo.toml` for importer tests and `pnpm --filter @eve-space/api test:postgres` for the projection migration and database lookup tests.
