# Authentication Module Architecture

These rules refine the repository module-organization requirements for this directory.

## Dependency Model

- Policy modules own authentication error classification and import no adapters or workflows.
- Primitive modules own cryptographic operations and configuration access. They do not import
  persistence, providers, workflows, or transport.
- Persistence modules own focused OAuth-state, session, verified and pending character-token, and
  advisory-lock database operations. They may depend on primitives and other persistence modules
  only. Pending credentials remain encrypted and separate from verified token rows until promotion.
- Provider modules own EVE SSO discovery, exchange, refresh, and verification. They may depend on
  policy and primitives, but not persistence or application workflows.
- State leaves own process-local pending-recovery coordination without importing workflows or
  persistence. Recovery is retryable after a process restart.
- Application modules coordinate character lifecycle, token refresh, transactional domain events,
  and organization-compliance transitions. They depend on lower tiers; lower tiers never import
  them.
- Transport modules own Hono routing and may depend on every lower tier.
- Shared read admission is application-owned and transport-independent. It snapshots exact member
  ownership, lifecycle, token authorization revision and required scope. Admitted reads reverify the
  live member session and the original binding before reuse and before releasing asynchronous results.
  Safe denial contracts are policy leaves; cookie lookup and response headers remain transport-owned.

Dependencies point from transport through application workflows toward provider, persistence,
primitive, and policy modules. Keep the directory flat and do not add an aggregate facade or barrel.

The exact module membership and lower-tier import allowlists are defined in
`scripts/auth/boundaries.ts` and enforced by `scripts/verify-auth-boundaries.ts`.

## Transaction Composition

- OAuth state consumption remains one atomic delete-and-return operation.
- Character lifecycle application functions own their transactions and pass the active transaction
  to session and token persistence.
- Character lifecycle and token refresh acquire the shared character advisory lock before
  character-scoped mutation.
- Token writes retain compare-and-set generation checks even while advisory locks serialize current
  writers.
- Pending writes require the current owner, character lifecycle, verified generation, and expected
  attempt revision. A newer pending rotation must survive a stale writer or verifier; promotion
  removes pending state in the same transaction that advances verified authorization.
