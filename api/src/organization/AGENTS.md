# Organization Module Architecture

These rules refine the repository-level module organization requirements for this directory.

## Dependency Model

- Policy modules own pure domain types, decisions, validation, and errors. They may depend only on other policy modules and must not import parent API modules, built-ins, or packages.
- Adapters own focused database queries, transaction helpers, ESI-backed reads, and materialization. They may depend on policy and other adapters, but not on workflow orchestration or audit projections.
- Observability modules append or project audit records. Recorder leaves must not depend on adapters, services, or application orchestration.
- Services own focused authorization, assignment, compliance-group, and evidence workflows. They may depend on policy, adapters, observability, and other acyclic services.
- Application modules coordinate complete organization use cases and mutations. They may depend on lower tiers and other acyclic application modules.
- Entry modules run scheduled maintenance. Transport modules own Hono routing. Neither may be imported by a lower tier, and transport must not import scheduled entry points.

Dependencies point from transport and entry points through application workflows and focused services toward adapters, recorders, and pure policy. Same-tier dependencies must remain acyclic.

The exact module membership is defined in `scripts/organization/boundaries.ts` and enforced by `scripts/verify-organization-boundaries.ts`. Every new top-level TypeScript module in this directory must be added to that map in the narrowest valid tier.

## Composition

- Keep the directory flat and do not add an `index.ts` barrel.
- Keep pure policy independent of database, ESI, HTTP, queue, and process state.
- Keep transaction locks and reusable persistence operations in focused adapter modules rather than duplicating them in application stores.
- Keep append-only audit recorders independent of the workflows that emit through them.
- Split administrative stores from automatic convergence workflows when core compliance or scheduled work needs the latter.
