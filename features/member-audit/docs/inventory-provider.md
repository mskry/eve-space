# Member Audit asset inventory provider

`assets-inventory` implements inventory contract 1 for one corporation and at most 250
core-admitted readable characters. It requires `member-audit.assets.read`, the enabled assets
section, and host contract 1.2.0. Core supplies identity, corporation membership, current
organization/lifecycle/authorization/disclosure/activation revisions and collection status.
The provider cannot admit identities or read core tables. Core keeps visible coverage-only
subjects outside this evidence capability and merges their coverage at the consumer boundary.

The provider receives exactly `read-inventory-sources` and `read-asset-inventory`. Each request
uses two batched metadata reads around one compact-row read; it does not read each character's
full JSON snapshot, call ESI, collect another observation, or fetch custom names.

The derived header pins the source observation, validation time and complete authority tuple.
Compact items contain only grouping identities, exact positive integer quantities, blueprint
kind and permitted type/physical-root labels. Container chains resolve to station/system,
restricted or unresolved roots. Custom names and container names are excluded. Duplicate items
within an observation must agree on their source fields; unsupported quantities/identities or
conflicting records leave the projection unready. A complete empty observation has a ready
header and zero item rows.

Duplicate item IDs held by different admitted characters are excluded before filters. Affected
characters retain `conflicting-source` coverage; unaffected items still contribute. Groups use
(type ID, blueprint kind, physical-root key). Quantities are decimal strings, separately summed
for current and stale sources. Type/group/category/location filters operate after all admitted
sources and conflict detection. Group and holder pages use bounded keysets, with at most 100
rows; coverage pages also contain at most 100 rows. Coverage counts describe the entire admitted
set, independently of filters and page size.

Core's resource status determines current versus stale, including refresh failures. The source
validation clock must agree with that binding. The provider pins and rechecks observation,
validation and readiness after its item read, and refuses replacement, purge, readiness or
current-to-stale races with `INVENTORY_RESTART_REQUIRED`. Its internal continuations bind source
and admission fingerprints, read kind, filters and holder group. They must remain behind the
host's public cursor and before-use/reuse/release authorization checks.

Assets keep the latest complete current-authority snapshot, with no age-only expiry. The DTO's
`retainedUntil: 9999-12-31T23:59:59.999Z` represents that policy; it never grants authorization or
extends the lifecycle. `freshUntil` is the core-bound validation time plus the existing
60-minute collection interval. Complete older snapshots are included only as stale under that
same authority. Missing collection evidence is `never-collected` or `unavailable`; a valid
snapshot awaiting backfill, or an unsupported projection, is `incomplete`. None means zero.

See [operations and rollout gates](../../../docs/member-audit-operations.md#aggregate-inventory-projection)
for migration, backfill and privacy cleanup. Existing single-target asset panels continue to
read their original intentional snapshot DTO and resource-status contract.
