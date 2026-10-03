# ESI gateway reality check

Verdict: conditionally sound architecture; reconcile two definite maintenance defects, an acknowledged specification conflict, and one provenance follow-up. No architectural replacement or dependency upgrade is justified by this review.

Scope: current `docs/architecture.md`, `api/src/esi-gateway/AGENTS.md`, archived deepen-esi-module-interface, adopt-effect-esi-request-lifecycle, and harden-esi-rate-limit-admission designs against targeted current source. Read-only review; only this report was written.

## Findings

### R1 — Medium — Single execution-path invariant contradicts supported shared registrations

Type: definite semantic drift in the architecture contract, not evidence of duplicate network requests.

The scoped guide says one operation uses exactly one execution path (`api/src/esi-gateway/AGENTS.md:29`), and the archived deepening design's decisions 4 and 8 claim exclusive core/platform path selection. Current verification deliberately permits and requires BOTH registrations for ten operations, including wallet and mail (`scripts/verify-esi-egress.mjs:15`, `scripts/verify-esi-egress.mjs:94`). Their platform definitions actually exist (`api/src/esi-gateway/catalog-interface.ts:42`, `api/src/esi-gateway/catalog-interface.ts:49`). This is a durable current exception, not a temporary old/new migration shim.

The startup assertion's comment also claims exactly one callable/platform path (`api/src/esi-gateway/catalog-interface.ts:177`), but its duplicate test checks core-platform versus installed-platform definitions, and its missing-path test checks operation metadata presence rather than actual callable registration (`api/src/esi-gateway/catalog-interface.ts:179`, `api/src/esi-gateway/catalog-interface.ts:195`). Build-time egress verification provides the stronger registration check.

Action: discuss/clarify the invariant as one dispatch per invocation, with explicitly reviewed shared core/platform registrations and separate canonical/wire cache representations. Ratify current practice in the active guide and assertion comment; preserve archived records as historical decisions. Do not remove either registration merely to satisfy stale prose.

### R2 — Medium — Egress verifier accepts straightforward raw-fetch bypasses

Type: definite enforcement defect; no existing production bypass established by this finding.

The documented gateway boundary requires all ESI access through registered gateway execution. `hasDirectEsiFetch` only recognizes calls whose callee is named `fetch` and whose first argument is directly a literal URL (`scripts/verify-esi-egress.mjs:786`, `scripts/verify-esi-egress.mjs:796`, `scripts/verify-esi-egress.mjs:799`). It does not resolve even a same-file constant or a `globalThis.fetch` alias.

Evidence: executed the real verifier against three disposable `/tmp` fixtures sharing a valid status registration and minimal catalogs. `fetch('https://esi.evetech.net/latest/status')` was rejected. Both `const url = 'https://esi.evetech.net/latest/status'; fetch(url)` and `const request = globalThis.fetch; request('https://esi.evetech.net/latest/status')` were accepted with exit 0. Fixtures were deleted. No network request was executed.

Action: fix static URL and fetch alias resolution for these ordinary patterns, using the verifier's existing AST helpers; add focused acceptance/rejection fixture cases. Describe remaining dynamic limitations explicitly. An architecture check is useful policy enforcement, but this result cannot support a claim that it proves every possible runtime egress path.

### R3 — Low — Review provenance does not connect current SDK to organization operation review

Type: follow-up recommendation / evidence gap, not a demonstrated wrong operation contract.

The organization operation review records SDK 3.0.1 and a 2026-09-07 review (`docs/organization-platform.md:184`), whereas the local SDK is 3.1.0 (`packages/esi-client/package.json:3`). Core metadata records a later 2026-09-27 review and the same resolved compatibility date 2026-08-18 (`api/src/esi-gateway/internal/operation-metadata.ts:4`), but does not bind the review to an SDK version or generated protocol-facts hash. The SDK's own snapshot provenance does contain that hash (`packages/esi-client/openapi/generated/provenance.json:18`). This prevents a reviewer from establishing whether the later review covers the organization catalog's changed SDK authority facts.

Action: reconcile the organization review record with the actual SDK and reviewed facts, and distinguish review timestamp from compatibility snapshot date. Do not silently rewrite the historical timestamp or claim a new live review without performing it. Existing generated descriptor consistency checks remain valuable but do not substitute for the required official endpoint review.

### R4 — Medium — Cached wallet quota contract remains an acknowledged unresolved spec conflict

Type: definite code/spec divergence, explicitly deferred by the deepening change; not a newly introduced runtime regression.

The active resilience spec requires quota captured during cache population/revalidation on cached wallet results (`openspec/specs/esi-resilience/spec.md:257`). Envelope v3 stores no quota (`api/src/esi-gateway/internal/types.ts:37`, `api/src/esi-gateway/internal/envelope.ts:103`), and fresh cache hits use `toCachedResult` without its optional quota argument (`api/src/esi-gateway/internal/execution-runtime.ts:958`, `api/src/esi-gateway/internal/execution-runtime.ts:1498`). Thus cached results return `{}`.

This discrepancy was already identified and intentionally deferred to preserve behavior and avoid a Redis-envelope change (`openspec/changes/archive/2026-09-12-deepen-esi-module-interface/reconciliation.md:31`). That accepted migration constraint explains the implementation, but does not reconcile the active specification.

Action: discuss and choose an explicit contract follow-up: adopt empty cached quota in the specification, or persist the historical snapshot in a separately scoped envelope change. Keep historical quota descriptive only; it must never authorize an attempt or replace live coordination admission.

## Ratified current reality

- The SDK remains local 3.1.0; the pinned generator is 0.99.0 and Effect is exactly 4.0.0-rc.115 (`packages/esi-client/package.json:3`, `pnpm-workspace.yaml:19`, `pnpm-workspace.yaml:47`). This report introduces no technology bindings and makes no external claim that these are the latest releases.
- Protocol method/path/scopes/roles/rate declarations are derived from SDK operation descriptors, while fallback cache policy and minimum compatibility dates remain application-owned (`api/src/esi-gateway/internal/operation-metadata.ts:269`, `api/src/esi-gateway/internal/contract-types.ts:138`). The current authority separation is appropriate; no independent hand-maintained protocol ledger should be introduced.
- Effect is scoped to request lifetime and remains behind Promise contracts (`api/src/esi-gateway/internal/request-lifecycle.ts:1`, `api/src/esi-gateway/internal/request-lifecycle.ts:92`). The executor joins metadata observation to that lifetime (`api/src/esi-gateway/internal/execution-runtime.ts:621`, `api/src/esi-gateway/internal/execution-runtime.ts:650`), and runtime close waits for active work (`api/src/esi-gateway/internal/execution-runtime.ts:1443`). Pinning a prerelease is an explicit compatibility choice, not by itself a finding requiring an upgrade.
- The bloodlines validation exception still matches the local non-null SDK schema and remains narrowly declared (`docs/architecture.md:300`, `api/src/esi-gateway/internal/catalog.ts:224`, `packages/esi-client/src/generated/zod.gen.js:5425`). No live data was fetched, so this ratifies local consistency only.

## Limitations

Inherited graph evidence was stale by three commits (index 52135c6, HEAD 35bf357), graph query/context results were malformed or missing, and no `check_index_coverage` tool was available. All material findings above therefore use exact source reads or the real verifier fixture experiment, not graph absence. No complete call-graph or security-absence claim is made. No repository files were changed and no runtime/integration suites or builds were run by this lens.
