# Platform Engineering Guide

Browser aggregate admission is a metadata-only service over the same installed declarations and full core bindings as GraphQL. Its transport validates selectors, uses live member sessions and emits private no-store responses. Corporation discovery calls organization-owned current-snapshot storage only after exact reviewer admission; it does not read module evidence. Neither metadata endpoint authorizes a later inventory read or grants browser persistence.

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
- Read admission services compose module/section enablement with the organization-owned policy and
  optional exact owned-character admission. Public reads have no session or organization gate.
  Capability adapters construct exact installed read-only grants; guarded methods recheck the fixed
  admission before execution or reuse and after asynchronous work. Transport adapters share these
  interfaces rather than supplying independent authorization decisions.
- Application modules execute complete resource collection or observation use cases.
- Entry modules initiate scheduled repair or maintenance work.
- Transport modules compose HTTP routes and middleware. They never initiate scheduled work.
- Platform modules never import queue modules. Queue delivery adapts BullMQ jobs to platform use
  cases so the queue depends on platform, never the reverse.
- Keep organization integration imports narrow: platform may call the explicit core-resource
  materializers and compliance convergence operations, but generic platform policy must remain
  organization-independent.
  Read admission is an explicit integration seam for organization session loading and contribution
  authorization; it must not query organization tables or reimplement organization decisions.
- `scripts/verify-platform-boundaries.ts` must reject undeclared modules, forbidden tier imports,
  platform-to-queue imports, and platform dependency cycles.

## Collection Invariants

- Preserve the five-part collection identity and its canonical serialization.
- Keep durable eligibility checks ahead of token access and treat stale work as a no-op.
- Materialization and successful collection-state advancement remain atomic.
- Batch classification must correlate every attempted subject exactly once.
- Queue payloads contain stable identities only and never private ESI data or credentials.

Inventory capabilities compose exact installed consumers with core subject-set admission and
source-owned personal/provider reads. Source pages, enrichment and provider persistence share
the caller's finite work admission; checks inside an occupied slot use slot-local work. Pure
cursor parsing depends on the shared inventory digest policy and public DTO contract. Personal
pagination consumes complete source reductions; corporation pagination wraps source checkpoints
and merges visible coverage-only subjects without granting them evidence authority. GraphQL
owns propagation of the original guard through its nested DTO projections.
