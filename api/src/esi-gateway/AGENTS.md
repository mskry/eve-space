# ESI Gateway Engineering Guide

These instructions apply to `api/src/esi-gateway` in addition to the repository-wide guide.

## Dependency Direction

This subsystem uses support, representation, contract, infrastructure, execution, recorder observability, and aggregate observability tiers. The tier names describe ownership and dependency direction; they are not a template for unrelated directories.

- Support modules are dependency leaves and import no other ESI gateway modules.
- Representation and contract modules form the pure tier group. They may depend on support and each other, but never on infrastructure or execution.
- Infrastructure modules own connections, sockets, and raw transport behavior. They may depend on the pure tiers but never on execution.
- Execution modules orchestrate infrastructure and the pure tiers.
- `internal/production-runtime.ts` is the composition root and the only gateway module that reads application configuration. It passes resolved immutable configuration into execution and infrastructure implementations.
- Recorder-only observability modules may be imported by any tier and must not depend on execution. Aggregate observability may read execution state when explicitly allowed, but must not initiate or own execution.
- Pure modules, infrastructure, execution, and recorders must not import aggregate observability. Pure result metadata belongs to the representation tier.
- External imports require an explicit allowance: shared libraries and pure helpers are available across tiers, while generated catalogs, authentication, and Redis dependencies are restricted to their declared callers. New repository modules, packages, and package subpaths are rejected by default; type imports follow the same rules.
- The root exposes only `feature-execution`, `platform-execution`, `catalog-interface`, `failures`, `runtime-lifecycle`, and `status-interface`. Each is a behavior-owning seam, never a re-export barrel.
- All other gateway modules belong in `internal/`. Outside callers, including tests outside the gateway-owned test directory, must not import them directly.
- `scripts/esi-gateway/boundaries.ts` is the source of truth for exact module-to-tier membership, allowed tier imports, and narrow module exceptions. Update it when adding or moving an ESI gateway module.
- `scripts/verify-esi-gateway-boundaries.ts` must continue to reject undeclared modules, dependency cycles, and forbidden external imports.

## Execution Seam

- Feature code executes ESI through a registered representation. It must not construct SDK domain clients, resilient transports, principals, credentials, revalidation headers, retry policy, or cache policy.
- `internal/request-lifecycle.ts` is the only gateway module that depends on Effect. It owns the scoped permit, supervised TTL-derived renewal, fetch/body cancellation, body-and-observation settlement, and final release for one upstream attempt; keep the registered Promise interfaces and SDK/application error identities outside that Effect boundary.
- Accepted runtime work includes request-lifecycle finalization. Runtime close must stop admission and await active response bodies, issued renewals, and permit release before local state or process-owned dependencies are closed.
- The SDK owns one typed protocol attempt, its deadline, protocol metadata, and policy-neutral failure classification. The gateway owns authorization, SDK binding, cache and stale policy, retries, permits, cooldowns, resource revisions, and telemetry.
- The execution implementation owns authorization resolution, transport, caching, retries, request collapse, fencing, cooldown recording, telemetry, and resource revisions.
- One operation uses exactly one execution path. While migrating, operations may sit on either path, but never layer the registered interface over the older public execution methods.
- Retire the old seam rather than wrapping it. Compatibility shims are not an acceptable migration artifact.

## Representations

- A representation owns input encoding, cache-identity projection, SDK binding, and, for core reads, canonical result mapping. Every cached result belongs to exactly one.
- Cache identity includes the representation name and version. Registration rejects duplicate and inconsistent registrations.
- Callers do not supply per-call mappers for cached results.
- Changing what a representation means requires a representation-version increment. Two concurrent representations of one operation require distinct names in cache identity.
- Derive an operation's required scope from its registered representation rather than looking it up separately at the call site.

## Identity Projection

- Array-valued identity requires an explicit operation-specific projector. Never infer identity by walking an input object for a matching property.
- Equivalent sets must produce one identity, and distinct sets must not collide. Empty, oversized, and malformed inputs fail closed.
- The recursive lookup in `identity.ts` is reachable only from SDK-envelope-shaped inputs. Moving an array-body operation onto envelope-shaped representation input exposes it to that path, so a projector must exist before the move.

## Authorization

- Operation authorization has two kinds: public and character. There is no operation-level lifecycle kind.
- Organization and deployment lifecycle generation checks are caller-side concerns layered above a public-authorized operation. They stay with the caller and do not migrate into a representation.
- A character ID selects credentials and required scopes. It is never evidence that the requesting user owns that character; ownership stays with `middleware/owned-character.ts`.
- Tokens, credentials, and principal strings never cross the feature-facing seam.

## Requests And Mutations

- Conditional revalidation headers are executor-owned. Caller input types must not express them, and caller-supplied `If-None-Match` and `If-Modified-Since` must be rejected at runtime.
- Generated request schemas validate headers loosely and retain unrecognized keys, so dynamic dispatch must constrain headers itself rather than trusting the schema.
- Generic SDK mutation execution requires both `allowGenericMutations: true` on the adapter and `confirmMutation: true` on the invocation, and only for catalog-declared mutations. Undeclared mutations fail before any network activity.
- Read-like POST operations stay on the read path and never receive mutation confirmation.

## Platform Execution

- Dynamic platform execution uses its own internal executor rather than exposing transport, credentials, or resilience mechanics to platform orchestration.
- Core callers must not import platform execution. Installed modules must not import core execution or SDK runtime code.
- Platform cache entries hold validated SDK wire data as an explicit exception to canonical mapped representations. Mapping runs after cache retrieval and before materialization or HTTP exposure; do not describe it as preceding caching.
- Public platform operations report a null authorization generation; character operations report a verified one.

## Testing

- Primary behavior tests cross the registered execution interface. Reserve internal adapter tests for real seams such as Redis coordination and response-body transport lifetime.
- Delete tests that assert on a retired seam once equivalent behavior is covered through the registered interface. Do not keep duplicate test layers.

## Change Ownership

`deepen-esi-module-interface` owns this gateway seam. `deepen-queue-modules` owns neutral coordination Redis, `harden-codebase-quality` owns permit-loss and shutdown policy, and `deepen-character-modules` owns character-domain interfaces. Do not duplicate those responsibilities here.
