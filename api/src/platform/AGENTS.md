# Platform Engineering Guide

These instructions apply to `api/src/platform` in addition to the repository-wide guide.

## Dependency Direction

The platform subsystem uses representation, declaration, state, adapter, service, application,
entry, and transport tiers. Exact file membership belongs in
`scripts/platform/boundaries.ts`.

- Representation modules own pure identities, schemas, normalization, and deterministic policy.
  They may import only sibling representation modules and their narrow schema or contract packages.
- Declaration modules assemble installed resources and executable operation bindings from
  representation modules.
- State modules own process-local mutable state. Do not embed caches, counters, or in-flight loads
  in their consumers.
- Adapters own PostgreSQL access, module capabilities, and focused materialization boundaries.
- Services coordinate declarations, adapters, and state without owning complete collection jobs.
- Application modules execute complete resource collection or observation use cases.
- Entry modules initiate scheduled repair or maintenance work.
- Transport modules compose HTTP routes and middleware. They never initiate scheduled work.
- Platform modules never import queue modules. Queue delivery adapts BullMQ jobs to platform use
  cases so the queue depends on platform, never the reverse.
- Keep organization integration imports narrow: platform may call the explicit core-resource
  materializers and compliance convergence operations, but generic platform policy must remain
  organization-independent.
- `scripts/verify-platform-boundaries.ts` must reject undeclared modules, forbidden tier imports,
  platform-to-queue imports, and platform dependency cycles.

## Collection Invariants

- Preserve the five-part collection identity and its canonical serialization.
- Keep durable eligibility checks ahead of token access and treat stale work as a no-op.
- Materialization and successful collection-state advancement remain atomic.
- Batch classification must correlate every attempted subject exactly once.
- Queue payloads contain stable identities only and never private ESI data or credentials.
