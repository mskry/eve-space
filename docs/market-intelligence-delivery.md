# Market Intelligence deployment and rollback

## Deploy

1. Deploy API with ordered core migration `020_sde_solar_system_region.sql` and the Market module baseline `market-001-initial.sql`. Wait for module routine attestation before starting the worker. Do not remove or reset the existing PostgreSQL or queue volumes. A database that applied the earlier draft Market migration chain must first have its Market migration and attestation state re-baselined without losing data (see `features/market/server/AGENTS.md`); never run the baseline over existing draft tables.
2. In an isolated or backed-up environment, run the official one-shot SDE importer after API migrations. Projection version six adds `mapSolarSystems.regionID`; a prior committed projection remains readable for the catalogue but cannot validate new station-to-region profiles. Do not reingest just to mask a source failure.
3. Add `esi-markets.structure_markets.v1` to requestable `EVE_SCOPES` when SSO is enabled. Existing characters keep their existing authorization; only a character selecting a private structure market needs exact-character reauthorization for this new scope. Deploy the worker after matching API/module migration readiness.
4. Keep public collection profiles disabled until an administrator explicitly enables a measured profile. Begin with one watched Tritanium (`34`) profile in low-volume region `10000058`. Verify the published complete observation, its original page validation window and `cachedUntil`, empty sides, quote partial fill and the independent daily-history source time. Only then consider larger coverage.
   PLEX (`44992`) belongs to the separate Global PLEX Market (`19000001`): enable only a watched-type profile for that exact type with no station filter, and label its observations as global rather than The Forge. Never infer a regional PLEX quote from the global book.
5. Grant `market.structure.read` deliberately through current organization group policy to eligible members. An administrator-only deployment login is not organization admission. Verify non-owned characters, missing ESI scope, revoked ownership/generation, changed organization version or permission, disabled Market, and a private structure outside the current character binding all fail closed. Queue jobs and telemetry must contain identities and counts only.

## Watch

Batch staging adds the ordered `market-003-batch-staging.sql` migration after
`market-002-collected-publication.sql`. Deploy matching generated API/worker inventories,
let the API install and attest the routine, then start the matching worker. Fresh installs
apply all three migrations; upgrades preserve complete and partially staged observations.
The old single-page routine remains installed, but the public orders collector receives
only the new typed batch operation. No applied migration is rewritten.

Public staging defaults to 10 pages per transaction. The declared persistence ceilings
are 20 pages, 20,000 orders, and 16 MiB of input.
Cancellation and module eligibility are checked between batches; SQL locks and revision
checks fence each batch and publication against profile changes. Source expiry still
controls stale presentation and next refresh, rather than acting as a staging deadline.
See [the module contract](../features/market/docs/contract.md) for replay and publication
semantics.

Three fresh-process trials per policy on local PostgreSQL 17.11 and Node 24.20.0 used
406 synthetic pages containing 405,500 orders through installed persistence capabilities.
Content and original page metadata matched across all nine trials. Median staging fell
from 11.959 seconds / 406 transactions to 8.560 seconds / 41 transactions with 10-page
batches. The 20-page policy took 8.256 seconds / 21 transactions, but its worst invocation
was 489 ms versus 224 ms and median peak RSS was 1,207 MiB versus 1,146 MiB. The 10-page
default balances those measured costs. These are fixture-playback measurements, not live
ESI latency. The one-off harness and dedicated report were removed after measurement at
the user's request; raw local evidence remains in `/tmp/eve-70-benchmark.log`.

Public regional books are bounded to one full-region profile, four configured profiles, 16 watched types, 512 pages, 512,000 orders and three simultaneous page requests. The private structure path is bounded to four distinct structures per character/lifecycle/generation/organization day, 32 pages, and 32,000 orders. Queue high-water admission and the registered market-order cooldown defer work without moving its PostgreSQL due time. A lost derived queue job is reconstructed from due profile and history state; on-demand structure requests can be repeated after the per-selector suppression window.

The measured Forge book comprised 405 pages, 404,567 unique orders and about 96 MB of uncompressed ESI JSON. A 1,000-row PostgreSQL sample including indexes grew by 303,104 bytes; current plus three superseded books during a 15-minute raw rollback horizon can require roughly 492 MB at that density, before WAL and vacuum. Observe actual worker duration, queue age, page/order counts, gateway cache hits, quota/cooldown, profile failure class and database growth before broadening collection. Reference prices are non-executable hourly statistics; raw complete snapshots, compact derived metrics, daily history and references have separate retention clocks documented in the source review.

## Roll back

Disable active public profiles first, then disable the Market module through deployment settings to stop routes, work and page admission. Preserve the module schema, migration ledger, current and historic observations, queue AOF and audit history. Module cleanup is bounded and runs only while enabled. Do not delete a database volume or rewrite an applied migration. A prior binary can only be restored if it accepts the additive core/module schema and attestation contract; otherwise keep the matching API and worker deployed while Market remains disabled.

## Batch staging verification

The local rollout on 2026-10-01 built matching API and worker images, applied migration
`market-003-batch-staging.sql`, and passed strict installed-routine attestation. An existing
local `EVE_SCOPES` override omitted `esi-markets.structure_markets.v1`; adding that already-required
requestable scope restored API startup. API, worker, PostgreSQL, and both Redis services
reported healthy without replacing database or Redis volumes.

Both existing profiles were retained. The Forge complete pointer stayed unchanged; the
worker successfully refreshed the existing PLEX book. A temporary watched-type profile
verified complete-book reads during a partial replacement, failure cache behavior,
disabled-profile read rejection, and obsolete-batch/publication fences. Its fixture rows
were removed afterward. Superseded raw books remain subject to normal 15-minute retention.
See [the fetching review](market-batch-staging-fetching-review.md) for commands, test results,
and runtime evidence.
