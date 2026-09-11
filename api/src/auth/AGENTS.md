# Authentication Module Architecture

These rules refine the repository module-organization requirements for this directory.

## Dependency Model

- Policy modules own authentication error classification and import no adapters or workflows.
- Primitive modules own cryptographic operations and configuration access. They do not import
  persistence, providers, workflows, or transport.
- Persistence modules own focused OAuth-state, session, character-token, and advisory-lock database
  operations. They may depend on primitives and other persistence modules only.
- Provider modules own EVE SSO discovery, exchange, refresh, and verification. They may depend on
  policy and primitives, but not persistence or application workflows.
- Application modules coordinate character lifecycle, token refresh, transactional domain events,
  and organization-compliance transitions. They depend on lower tiers; lower tiers never import
  them.
- Transport modules own Hono routing and may depend on every lower tier.

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
