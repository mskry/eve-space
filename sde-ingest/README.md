# SDE ingestion CLI

The SDE ingestion CLI loads the latest official Tranquility Static Data Export into PostgreSQL. It
is a one-shot command: it checks the published projection, imports when necessary, and then exits.

## Quick start

Apply database migrations through the normal API startup or deployment flow first. If
`DATABASE_URL` is already exported in your shell, you can apply them directly from the repository
root:

```bash
pnpm db:migrate
```

Then run the importer:

```bash
pnpm sde:ingest
```

The CLI reads `DATABASE_URL` from the process environment or the repository's root `.env`. It has
no supported flags, positional arguments, or subcommands and always targets the latest official
SDE build.

The migration command and ingestion CLI do not load configuration identically: `pnpm db:migrate`
requires `DATABASE_URL` in the process environment, while `pnpm sde:ingest` also checks the root
`.env`.

The command can download an archive of roughly 100 MB and replace all published SDE tables in the
selected database. Check the database target before running it. Do not run the command against a
database whose migrations are behind the application.

## Command outcomes

A normal run reports one of these outcomes:

- `Nothing to do` means the database already contains an equal or newer SDE projection. No archive
  is downloaded.
- `Ingested SDE build ...` means the new projection was committed successfully. The preceding lines
  show the imported datasets, row counts, and elapsed time.
- `Completed with ... optional datasets skipped` is still successful. All required projections were
  committed, but one or more nonessential raw JSONL datasets could not be retained. The command
  prints the individual skip errors to standard error.
- An error and nonzero exit mean the required projection was not published. The previous committed
  projection remains active.

A newer build or a newer projection version for the same build triggers a complete reload. An older
build or projection cannot replace the active one, including when two ingesters overlap.

Projection version 6 retains nullable `sde_market_groups.icon_id` from the official `iconID` field
and projects the official `mapSolarSystems.regionID` into `sde_solar_systems.region_id`.
The market catalogue uses market-group ID, parent ID, English name, and icon ID; `sde_types` retains
type ID, English name, publication status, and market-group assignment. English descriptions remain
in the typed projection for other consumers but are not part of the compact market catalogue. The
source `hasTypes` hint is not retained because direct membership comes from published type
assignments. Inventory group publication does not remove a published market-assigned type. The
static projection contains no active-order coverage, order book, history, or regional price.

The published revision is the active `sde_builds` build number, `ingest_version`, and `ingested_at`
selected through `sde_projection_state`. A same-build version-6 reload updates the build row's
ingestion time and commits the full replacement atomically. An existing version-4 projection stays
published until that transaction succeeds; the nullable icon column does not create a partial
version-6 station-region identity before reingestion. See the [official market-group evidence](../docs/market-catalogue-sde-evidence.md).

## Retry a failed import

Correct the reported download, archive, migration, database, or data error and rerun:

```bash
pnpm sde:ingest
```

When a failure occurs after a complete archive has been downloaded, the CLI retains
`eve-sde-<build>.zip` in the operating system's temporary directory. The next run reuses it and
prints its exact path. Interrupted downloads use a `.zip.part` sibling and are never treated as a
complete archive.

Delete the specific retained ZIP only when the error shows that it is unreadable or corrupt, then
rerun the command to download a fresh copy. A successful publication performs best-effort cleanup
of current and stale SDE archives and partial downloads.

## Behavior and safety

Required projections publish atomically: table replacement, build history, and the active marker
commit together. Missing, empty, invalid, or unpersistable required data aborts the transaction and
leaves the previous projection available. Optional raw datasets are isolated so one failure does
not roll back the required projection.

The API notices most committed location and routing revisions while running. Restart every API
process after an import that changes the published skill catalogue because that catalogue is loaded
for the lifetime of the process.

For production, run the image from `sde-ingest/Dockerfile` as the deliberate one-shot deployment
described in [the Railway guide](../docs/railway.md). Run it only after the API deployment has
completed database migrations.

## Local verification

Run from the repository root:

```bash
cargo fmt --manifest-path sde-ingest/Cargo.toml --all --check
cargo clippy --manifest-path sde-ingest/Cargo.toml --all-targets --all-features --locked -- -D warnings
cargo test --manifest-path sde-ingest/Cargo.toml --all-features --locked
pnpm --filter @eve-space/api test:postgres
```
