# ESI gateway architecture: rubric review

Verdict: the existing architecture is coherent and has a deep, appropriately owned gateway interface. One medium documentation/invariant drift needs reconciliation; one low-priority recommendation would make representation evolution less dependent on implicit knowledge. No runtime architecture blocker was established by this review.

This evaluates the implemented brownfield architecture, not conformance to the new architecture-spine template. The absence of AD-n identifiers, Binds/Prevents/Rule fields, or a spine frontmatter is not a code defect.

## Evidence and limits

Reviewed the gateway engineering guide, public execution/lifecycle/status/catalog interfaces, representation registration, production composition, execution-runtime entry points and identity construction, request lifecycle, the dependency-boundary verifier, ESI egress verification, root architecture and cache policy, current esi-query-policy/esi-resilience specifications, and the archived deepening design.

Structural graph results are not reliable for this run: the supplied index was three commits behind HEAD, concept queries returned corrupt symbol/path data, and createEsiExecutionRuntime context was missing. Targeted source verification supplied the evidence below. This is not an exhaustive caller, cycle, or security proof. No source changes or runtime checks were performed by this reviewer. No new technology choices or versions were bound.

## Finding R1 — MEDIUM — Documented single-path invariant contradicts required dual registrations

Classification: documentation/invariant defect; discuss/reconcile, not a runtime failure.

Primary evidence: `api/src/esi-gateway/AGENTS.md:29`; corroboration `api/src/esi-gateway/catalog-interface.ts:177`, and archived `openspec/changes/archive/2026-09-12-deepen-esi-module-interface/design.md` Decision 4.

The guide states that one operation uses exactly one execution path. The catalog initializer is described as checking that invariant. However, `scripts/verify-esi-egress.mjs:15` enumerates ten operations shared between core callable and platform execution, and `scripts/verify-esi-egress.mjs:94` explicitly rejects losing either registration. The architecture has adopted a bounded permanent exception that its authoritative guidance still describes as forbidden.

Impact: an independently built callable or platform capability can follow the documented rule and remove a registration that repository verification requires. Conversely, another builder can infer that arbitrary operations may use both paths. This is a real divergence point involving representation ownership and startup verification, rather than a naming preference.

The inspected code keeps the distinction deliberate: core callable execution supplies a representation name (`internal/execution-runtime.ts:329`); platform execution caches SDK wire data without that name (`internal/execution-runtime.ts:417`). Both converge on the same runtime and catalog. No evidence here demonstrates a cache collision or duplicate network attempt within a single execution.

Smallest correction: amend the active guide and the misleading catalog-initializer comment to state that each _representation/caller contract_ selects one path, while reviewed shared operations may expose both canonical core and wire platform representations with distinct identities. Link to the existing mechanical allowlist and specify the ownership/version rule for the exception. Keep the archived design as history, optionally adding a reconciliation note rather than rewriting the original decision. Do not remove either execution path merely to satisfy the stale wording.

## Finding R2 — LOW — Make the operation-scoped representation-version ownership explicit

Classification: recommendation; defer until the next mapper/schema change or another shared operation is added. No stale-data defect is established in current behavior.

Primary evidence: `api/src/esi-gateway/feature-execution.ts:33`; corroboration `api/src/esi-gateway/internal/execution-runtime.ts:939`, `api/src/esi-gateway/internal/catalog.ts:40`, `api/src/esi-gateway/AGENTS.md:37`.

The public read definition owns name, mapper, and result schema, but has no version field. The runtime obtains representationVersion from the operation catalog and uses it for every representation of that operation. This is consistent implementation, but the guide only says to increment a representation's version when its meaning changes. It does not spell out that a feature's mapper/schema change must update an internal operation-level catalog version, or that the bump invalidates both callable and platform identities for shared operations.

Impact: feature authors can change semantically compatible DTO fields under the same representation name while overlooking the separate catalog edit, especially if a schema still accepts the prior envelope. Independently maintained representations also cannot evolve their version without a joint operation-wide cache invalidation. This is an evolution risk, not proof that a current migration failed to bump its version.

Smallest correction: document the present owner and rule: a mapper, cache schema, or identity semantic change requires a reviewed bump of that operation's catalog representationVersion, including the effects on shared platform caches. If independent representation evolution later becomes necessary, consider a representation-owned version in the factory while retaining operation compatibility/version policy; do not add that API now without a concrete need.

## Rubric assessment

- **Paradigm and boundary ownership:** coherent policy-owning gateway with ports/adapters inside its implementation. Callables hide registration order, token resolution, transport, retries, shared caches, permits, and lifecycle. SDK ownership remains a single typed protocol attempt. No generic external executor/DI container is exposed.
- **Depth and independent divergence:** registration plus execution is a meaningful seam. Distinct core canonical DTO and platform wire-cache paths are appropriate and explicit in the active guide. R1 is the material mismatch in how those paths are constrained.
- **Dependency directions:** documented support/pure/infrastructure/execution/recorder/aggregate tiers are encoded in `scripts/esi-gateway/boundaries.ts`. External dependency allowlists, cycle checks, consumer restrictions, and an internal-import prohibition provide enforcement. This review does not assert a complete graph-based cycle audit.
- **State and shared data:** separate disposable Cache Redis and durable coordination Redis owners, namespace epochs, fences, authorization lifecycle/generation, resource revisions, and representation names/versions are specified and represented in the runtime. R2 concerns who changes versions, rather than missing versioned keys.
- **Operational/environmental envelope:** present, not silently deferred. `docs/architecture.md:164` specifies shutdown order and bounded process cleanup; its Queue Redis and Cache Redis sections specify durability, eviction, deployment security, recovery and sizing. `docs/architecture.md:232` documents conservative coordination degradation; `:238` documents permit/body/finalizer ownership. The scoped Effect request lifecycle preserves Promise-facing contracts.
- **Brownfield and spec alignment:** the archived deepening design is substantially ratified by the seven explicit public seams and internal runtime composition. Query identity, operation catalog, stale/fresh/retention distinction, authorization-before-release, quota policy, and metadata boundaries have identifiable owners. The allowlisted dual paths are an implemented evolution requiring reconciliation with the earlier single-path decision.

Recommendation: retain the current public seams and runtime ownership. Reconcile R1 and clarify R2 before describing the architecture as a fully consistent build substrate. A broad internal split or replacement of the gateway is not justified by this rubric review.
