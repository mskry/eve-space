# Queue Engineering Guide

These instructions apply to `api/src/queue` in addition to the repository-wide guide.

## Dependency Direction

The queue subsystem uses representation, adapter, application, orchestration, execution, and
observability tiers. Exact file membership belongs in `scripts/queue/boundaries.ts`.

- Representation modules own queue contracts, schemas, stable identities, namespace and policy
  values, outcome formats, and semantic producer interfaces. Their queue-local dependencies remain
  within the representation tier.
- Adapter modules own BullMQ and coordination Redis delivery details. They may depend only on
  representation and other adapter modules; they never import application, orchestration,
  execution, or observability modules.
- Application modules perform domain-specific planning, relay, and follow-up use cases through the
  semantic producer. They may depend on representation, other application modules, and narrow
  observability recorder interfaces, never queue adapters.
- Orchestration modules compose application operations and handler dispatch. They may depend on
  representation, application, and other orchestration modules, never queue adapters.
- Execution modules own worker and scheduler runtime lifecycles. They compose representation,
  adapters, orchestration, execution support, and observability without exposing those details to
  callers.
- Observability modules record or inspect queue state. Recorder leaves depend on representations;
  aggregate readers may inspect adapters, but observability never initiates application,
  orchestration, or execution work.
- Queue modules never import ESI-resilience directly. Domain and platform use cases own that seam so
  queue execution depends on those use cases rather than external ESI behavior.
- The job-contract catalog is enqueue-time representation. Keep its imports limited to reviewed
  schema, identity, deterministic hashing, and configuration dependencies; it must not import
  BullMQ, Redis, databases, domain-event execution, ESI resilience, or worker runtime modules.
- `scripts/verify-queue-boundaries.ts` must reject undeclared or missing modules, forbidden tier
  imports, adapter-to-orchestration imports, impure job-contract imports, direct ESI-resilience
  imports, and queue dependency cycles.

## Delivery Invariants

- BullMQ types and owned connections stay behind queue adapters and execution modules.
- All enqueueing crosses the semantic producer interface, which owns payload validation,
  identities, admission, retries, retention, delay, priority, and deduplication.
- PostgreSQL remains authoritative for reconstructible work; domain-event delivery remains at least
  once and queue payloads never contain credentials or private ESI data.
- Worker liveness is replica-scoped and independent of aggregate backlog health.
