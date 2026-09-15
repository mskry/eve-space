# Query Persistence Module

The external seam is `runtime.ts`. Application callers import lifecycle, admission, invalidation,
readiness, and presentation operations from that module rather than coordinating the subsystem's
internal seams themselves.

## Dependency Direction

- Runtime orchestration depends on private lifecycle, runtime state, entry state, envelope policy,
  storage and notification adapters, and dependency-free validation leaves.
- Private lifecycle owns verified user identity, admission attempts and deadlines, lifecycle
  revisions, durable invalidation generation decisions, private persistence and access gates,
  renewal and expiry timers, browser lifecycle checks, cross-tab notification subscriptions, and
  disposal. It receives narrow callbacks for runtime-owned cache, envelope, hydration, and entry
  state behavior and must not import runtime state, runtime orchestration, or entry state.
- Runtime state may depend on entry state and envelope representations but not on adapters or
  orchestration. It retains query cache, envelope, hydration, public staging, presentation revision,
  and entry state only.
- Entry state owns all per-key provenance, original success timestamps, restored/local/failed
  status, and removal tombstones. It may depend on envelope retention policy, ESI freshness and
  query-error utilities, and platform presentation types, but never runtime state, query caches,
  storage, notifications, or adapters.
- Envelope policy may depend only on dependency-free local leaves within this directory.
- Storage and notification adapters may depend on envelope policy and dependency-free local
  leaves. They must not import private lifecycle, entry state, runtime orchestration, or runtime
  state, and they return outcomes or notifications rather than initiating query-cache transitions.
- Dependency-free leaves import nothing from this directory.
- Production application callers use only the external runtime seam. Subsystem tests may import
  private lifecycle, internal policy, entry state, runtime state, and adapter seams directly when
  testing those implementations.

Keep the directory flat and do not add an `index.ts` barrel. Declare new modules and their allowed
dependencies in `scripts/query-persistence/boundaries.ts`; the verifier is the authoritative file
inventory.

## Readiness States

1. Storage restoration settled means the durable read, parse, and any required pruning write have
   settled. It does not mean Nuxt hydration has finished or retained private data is admitted.
2. Post-Nuxt-hydration cache release means staged cache data may be reconciled with the hydrated
   query cache. Public fallback release is independent of private admission.
3. Admitted retained private cache access means the verified owner, current admission, durable
   invalidation generation, deadline, and private persistence gate all still match. Only this state
   permits retained private data to be exposed or written.
