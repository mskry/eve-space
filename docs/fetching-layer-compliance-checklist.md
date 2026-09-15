# Fetching-layer compliance checklist

Use this checklist to review an end-to-end fetching path: Vue consumer, query definition, mounted application API route, server resource execution, ESI exchange, and any restored browser data. It covers `@evespace/esi-client`, Pinia Colada, and the official cache persister.

## Review procedure

1. Record the review scope, commit, and relevant working-tree changes. Read root and applicable scoped `AGENTS.md` files. Preserve existing work.
2. Inventory the request paths in scope using the table below. Include prefetch, imperative cache fetches, recovery hooks, and mutations, not only `useQuery` calls.
3. Trace each path through the final route mount in `api/src/index.ts`. Read the implementation and tests supporting each applicable check.
4. Record each check as `PASS`, `FAIL`, `BLOCKED`, or `N/A`. A pass requires concrete evidence; `N/A` requires a reason. Missing runtime evidence is blocked, not passed. An unchecked box means unreviewed.
5. Run the applicable checks in the verification section. A static verifier passing does not prove lifecycle behavior.
6. Produce the report at the end of this document. When asked only to audit, report defects and proposed fixes; implementation requires a task that authorizes changes.

Root and scoped engineering instructions establish repository policy. This checklist operationalizes them and adds explicit design-review questions. If policy, implementation, tests, or specifications disagree, record the exact conflict and the decision needed. Existing code or a green test does not authorize a policy expansion.

In particular, check the current browser-persistence allowlist in root `AGENTS.md` before accepting additional persistence categories. Support for public or organization partitions in code is not itself permission to persist them.

### Request inventory

Create one row per distinct request and access policy; split rows when execution contexts differ.

| Consumer / query definition | Key and result-changing inputs | Trigger / SSR-capable?           | Final method + route | Mounted authorization      | Resource / ESI operation                          | Persistence eligibility                 |
| --------------------------- | ------------------------------ | -------------------------------- | -------------------- | -------------------------- | ------------------------------------------------- | --------------------------------------- |
| `path:line`                 | Subject, page, filters         | Mount, event, prefetch, recovery | Method and full path | Middleware + subject check | Registered representation / operation ID, or none | Policy reference and partition, or none |

## 1. Responsibility and module interfaces

- [ ] **MOD-01** — Browser feature code requests application DTOs through the established query/client infrastructure. EVE token resolution, refresh, encryption, ESI caching, and upstream coordination stay server-owned.
- [ ] **MOD-02** — The SDK owns one typed protocol attempt, response validation, its request deadline, metadata, and policy-neutral failure classification. Application retries, caching, OAuth refresh, and shared limit coordination have a clearly identified server owner.
- [ ] **MOD-03** — Core feature callers use the registered gateway execution interface. SDK construction and `createEsiTransport(operation, principal?)` binding remain in the allowed server implementation. Installed feature modules use platform dispatch and do not import SDK runtime code.
- [ ] **MOD-04** — Gateway representations own cache identity, SDK binding, and canonical mapping where required. Meaning changes increment representation versions. The documented platform wire-cache exception maps results before materialization or HTTP exposure.
- [ ] **MOD-05** — Query-persistence consumers use `app/query-persistence/runtime.ts`; they do not coordinate its internal state, envelope, storage, or notification adapters. Dependency direction follows the scoped guide and mechanical verifier.
- [ ] **MOD-06** — Shared helpers and types have one owner. Feature pages do not duplicate session/restoration state machines, retry decisions, or freshness calculations.

Starting points: `api/src/esi-gateway/AGENTS.md`, `api/src/esi-gateway/`, `app/query-persistence/AGENTS.md`, `app/utils/colada-options.ts`, `packages/platform-module-nuxt/AGENTS.md`.

## 2. Request authorization and SSR

- [ ] **AUTH-01** — Every request's access classification comes from its final Hono route mount and middleware, not from the publicity of the underlying ESI endpoint or a feature-router comment.
- [ ] **AUTH-02** — Protected SSR-capable queries are either disabled during SSR with the applicable client/authentication/ownership gate, or intentionally forward only the incoming cookie. `credentials: 'include'` alone is not cookie forwarding on the server.
- [ ] **AUTH-03** — Prefetch, recovery, reconnect, and imperative fetch paths obey the same access requirements as mounted queries. A browser-event mutation that cannot execute during SSR is classified accordingly.
- [ ] **AUTH-04** — Character routes validate the explicit character ID and load ownership through the established middleware before tokens or private resources are read. Character IDs and SDK principals are not ownership evidence.
- [ ] **AUTH-05** — Organization requests enforce current organization version, compliance, audience, and required permission before private reads. Deployment-administrator authority does not substitute for organization authority.
- [ ] **AUTH-06** — Query execution and cached-data presentation are both gated. A disabled query or a route redirect alone does not prove that retained private data cannot render.
- [ ] **AUTH-07** — Browser requests use the established credentialed application client. CORS remains restricted to `WEB_ORIGIN`; secrets and EVE tokens never enter browser payloads, persistence, query keys, or diagnostics.

Starting points: `api/src/index.ts`, `api/src/middleware/`, `app/queries/protected-character-query-access.ts`, `app/queries/auth.ts`, `app/composables/useAuthSession.ts`, `app/composables/useAuthVerification.ts`, `app/middleware/auth.global.ts`.

## 3. Query identity and application contracts

- [ ] **QUERY-01** — Keys distinguish every input that changes the result, including subject, pagination cursor/page, filters, and applicable organization version. Set-like inputs are normalized without changing order-sensitive inputs.
- [ ] **QUERY-02** — Private data is owner-isolated through verified partition binding and lifecycle clearing, with owner-bearing keys where the design uses them. A particular key tuple shape is not required; equivalent isolation needs evidence.
- [ ] **QUERY-03** — Changing character, owner, or organization context cannot expose the prior context's result through placeholder data, computed state, component-local copies, or an obsolete request completion.
- [ ] **QUERY-04** — ESI wire schemas remain SDK-owned, application request validation remains Hono-owned, and application response DTOs remain inferred through `AppType`. Browser RPC typing is not described as runtime response validation.
- [ ] **QUERY-05** — Chained Hono route definitions preserve inference; validation uses the repository wrapper and typed failure outcomes retain explicit JSON statuses.
- [ ] **QUERY-06** — Mutations invalidate the affected resource and dependent summaries. Authorization-changing mutations also use the private lifecycle invalidation interface. Optimistic state cannot masquerade as a newly validated persistent snapshot.

Starting points: `app/queries/query-keys.ts`, `app/queries/query-cache.ts`, feature query files, `api/src/http/validation.ts`, `packages/platform-module-nuxt/src/runtime/app/composables/usePlatformProtectedQuery.ts`.

## 4. Freshness, retention, and stale presentation

For each cacheable resource, record these independently. Do not substitute one duration for another.

| Clock                  | Evidence to collect                                                      |
| ---------------------- | ------------------------------------------------------------------------ |
| Upstream freshness     | ESI response metadata, fallback contract, computed expiry                |
| Browser freshness      | Colada `staleTime` and mount/focus/reconnect behavior                    |
| Query residency        | Colada `gcTime` and active/inactive behavior                             |
| Persisted retention    | Original success timestamp, maximum age, pruning on read/write           |
| Authorization validity | Verified owner, generation/revision binding, admission expiry where used |

- [ ] **TIME-01** — Server freshness derives from usable ESI `Expires` or `Cache-Control`; reviewed operation metadata is the fallback. Browser refresh and manual retry do not bypass upstream expiry.
- [ ] **TIME-02** — ETag/Last-Modified validators survive cache storage and are used for eligible revalidation. `304` reuses the prior validated body and updates metadata without attempting to parse a replacement JSON body.
- [ ] **TIME-03** — Restoration preserves original success times. Repeated reloads, serialization, failed refreshes, and optimistic/local writes cannot reset retention or make an old result newly validated.
- [ ] **TIME-04** — Normal browser restoration stays quiet. The UI reports failed restoration refreshes and server-reported outage-stale data when they occur, preserving their distinct provenance. Displayed timestamps describe what was actually observed or validated; background verification does not replace an already verified identity with an initial-loading state.
- [ ] **TIME-05** — Private server cache entries are generation-bound and not served stale on ordinary expiry. Outage fallback is bounded by retention and released only for `esi-unavailable` or `esi-cooldown`, never `response-invalid` or an authorization denial.
- [ ] **TIME-06** — Browser snapshot presentation has its own explicit admission and retention checks. Browser retention does not expand the server's stale-serving policy or prove current authorization.
- [ ] **TIME-07** — Background refresh and recovery use the central policy without duplicate timers or polling loops. Check the current auto-refetch allowlist in `scripts/verify-esi-query-persistence.ts`.

Starting points: `app/queries/query-policy.ts`, `app/utils/esi-freshness.ts`, `app/queries/query-recovery.ts`, `app/query-persistence/envelope.ts`, gateway cache implementations, `app/components/esi/ResourceBoundary.vue`.

## 5. Official persister and private lifecycle

- [ ] **PERSIST-01** — Eligibility is explicit and agrees with repository policy. Sessions, credentials, administrator state, and authorization decisions are excluded. Read `esiPersistence` declarations and the actual serializer/filter rather than assuming all successful queries are eligible.
- [ ] **PERSIST-02** — The official persister supplies query-cache serialization/restoration integration; application code owns authorization, envelope policy, and storage invalidation. Confirm behavior against the installed version, including hook ordering and asynchronous readiness.
- [ ] **PERSIST-03** — Restored values are untrusted: reject unsupported versions, malformed shapes/keys, invalid or future timestamps, expired records, identity/metadata mismatches, and invalid generation/revision bindings. Enforce bounded storage growth.
- [ ] **PERSIST-04** — Browser storage is used only in the browser lifecycle. Restoration settles on success and failure; it cannot indefinitely block startup. SSR and the initial client render remain deterministic, and restoration cannot overwrite a newer live or SSR result.
- [ ] **PERSIST-05** — Private snapshots stay unavailable until the live session verifies the same owner and any required subject admission succeeds. Persisted identity or permission fields never grant access on their own.
- [ ] **PERSIST-06** — Logout, owner change, and authentication denial clear in-memory and persisted private data. Session verification or cache admission without a verdict (network failure, timeout, or server error) suspends admission and keeps persisted data gated rather than deleting it. Character removal, token reauthorization/revocation, or relevant organization changes invalidate the affected bindings according to their current policy.
- [ ] **PERSIST-07** — Invalidation immediately closes presentation and prevents obsolete in-flight requests, asynchronous reads, delayed writes, or pending hydration from resurrecting private data. Cancellation is accompanied by lifecycle/generation checks where cancellation alone cannot guarantee this.
- [ ] **PERSIST-08** — Cross-tab invalidation and focus/pageshow/visibility recovery recheck current state. A tab missing a notification cannot later restore an invalidated snapshot or overwrite a newer invalidation generation.
- [ ] **PERSIST-09** — Storage unavailable, quota failures, corrupt records, and failed generation verification degrade safely to supported live-fetch behavior without admitting unverifiable private snapshots or crashing startup.
- [ ] **PERSIST-10** — Where short-lived admission is used, expiry closes retained access; slow renewals and obsolete responses cannot extend it. Organization scopes must trace to the authorized manifest and final route, subject to the persistence allowlist.

Starting points: `app/plugins/query-persistence.client.ts`, `app/query-persistence/`, `app/composables/useQueryPersistencePresentation.ts`, `api/src/cache-admission/`, `packages/platform-module-nuxt/src/runtime/esi-query-persistence.ts`.

## 6. ESI execution, retries, and pagination

- [ ] **ESI-01** — Every operation is registered with matching SDK descriptor, compatibility date, scopes, and executable contract. Endpoint and rate-limit facts have reviewed EVE API Explorer evidence; use `docs/organization-platform.md` where applicable.
- [ ] **ESI-02** — Identifiable user-agent headers and the pinned compatibility date are preserved. Response validation remains enabled except for the narrowly documented operation exception.
- [ ] **ESI-03** — Cache Redis stores disposable envelopes and lossy telemetry. Durable cooldowns, concurrency permits, request-collapse leases, and fencing stay on queue/coordination Redis. Cross-process behavior is verified with real Redis tests.
- [ ] **ESI-04** — Concurrent equivalent requests collapse correctly. Cache identity includes representation version and applicable authorization generation/resource revision; uncommitted fences and incoherent envelopes are rejected.
- [ ] **ESI-05** — Caller cancellation reaches the SDK's composed signal. The configured attempt deadline is preserved without competing independent deadlines around the same attempt. Permits remain held/renewed through response-body close, error, or cancellation and release exactly once.
- [ ] **ESI-06** — Both route-group limits and the legacy error budget influence execution. `429`/`Retry-After` and shared cooldowns prevent premature retries; periodic work is spread before limits are exhausted.
- [ ] **ESI-07** — Browser and server retry budgets are accounted for together. Authentication, scope, permission, and validation failures do not enter generic transient-retry loops. Retrying a mutation requires an operation-specific safety guarantee.
- [ ] **ESI-08** — Pagination is bounded and cancellable. Cursor tokens are opaque; initial `before` collection and incremental `after` updates preserve their distinct deduplication rules. Partial collections are not reported as complete.
- [ ] **ESI-09** — Applicable name-resolution paths preserve per-item positive caching and bounded negative suppression; a later inconsistent `404` does not overwrite a known successful name.
- [ ] **ESI-10** — Errors retain useful application classifications and retry timing without leaking secrets or raw private responses. Logs distinguish cache hits, upstream attempts, validation failures, and cooldowns sufficiently to diagnose repeated fetching.

Starting points: `packages/esi-client/README.md`, `packages/esi-client/docs/eve-space-adoption.md`, `api/src/esi-gateway/`, `api/src/universe/AGENTS.md`, `docs/organization-platform.md`.

## 7. Behavioral evidence matrix

Record an actual test name and assertion or a reproducible probe for each applicable row. The directories below are discovery starting points, not claims that every scenario already has coverage.

| Scenario                                             | Required observable outcome                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Same-owner reload                                    | Private snapshot appears only after live verification/admission, with its original age                     |
| Different-owner or anonymous reload                  | Previous owner's data never renders and is cleared                                                         |
| Failed session verification or denied admission      | Retained private access closes; private data is purged                                                     |
| Logout during fetch, restore, or delayed write       | Old work cannot repopulate memory or storage                                                               |
| Invalidation in another tab; suspended tab resumes   | Old generations are rejected before retained data is shown                                                 |
| Character access loss or token-generation change     | Affected character data becomes unavailable despite an unexpired cache                                     |
| Organization version or permission change            | Old grants/admission/snapshots cannot authorize current reads                                              |
| Malformed, future-dated, expired, oversized snapshot | Invalid data is rejected/pruned and startup completes                                                      |
| Storage failure or unavailable browser storage       | Live operation remains usable without unverifiable private restoration                                     |
| Repeated reload, local write, failed refresh         | Snapshot retention does not slide forward                                                                  |
| Fresh cache and manual refresh                       | Application recheck does not issue a premature ESI refresh                                                 |
| Conditional `304`                                    | Prior body is reused and response metadata is updated                                                      |
| Cooldown, upstream outage, invalid response          | Only allowed fallback classes can release bounded private stale data                                       |
| Slow body, cancellation, permit loss                 | Deadline/cancellation applies through body consumption; permit finalization completes                      |
| Parallel equivalent reads                            | Shared coordination bounds actual upstream attempts                                                        |
| SSR and hydration                                    | Public SSR works; protected requests obey cookie/client gates; no hydration mismatch or private-data flash |
| Mutation and context switch                          | Dependent views update without showing another context's data                                              |

Locate evidence in `tests/queries/`, `tests/auth/`, `tests/ui/`, `tests/platform/`, feature-owned browser tests, `api/tests/esi-gateway/`, `api/tests/cache-admission/`, `api/tests/integration/`, and platform-module package tests. Use deterministic fixtures and controlled clocks/failures rather than production accounts or intentional ESI rate-limit exhaustion.

## 8. Verification commands

Use Corepack-managed pnpm and the repository's required Node version. Package scripts and Vitest configs are authoritative; recheck them when this checklist is used. Record exact commands, exit status, and log paths. Complete artifact generation before dependent tests; do not run commands writing shared artifacts concurrently.

### Focused review checks

The following existing verifiers cover relevant structural rules and are also included in root lint:

```bash
pnpm exec node scripts/verify-esi-egress.mjs
pnpm exec tsx scripts/verify-esi-gateway-boundaries.ts
pnpm exec tsx scripts/verify-query-persistence-boundaries.ts
pnpm exec tsx scripts/verify-esi-query-persistence.ts
```

Run applicable behavior tests through the owning runner. Examples for a frontend/persistence audit:

```bash
pnpm exec vitest run --config vitest.config.ts tests/queries tests/auth tests/platform/query-persistence-boundaries.test.ts
pnpm --filter @eve-space/platform-module-nuxt test
```

The first command does not run `.nuxt.test.ts` or `.e2e.test.ts` suites. Use `pnpm test:frontend` for frontend unit and mounted Nuxt/UI suites, and `pnpm test:e2e` for production-server browser journeys when those behaviors are in scope. Record a missing environment as blocked. Do not substitute static checks for runtime evidence.

### Completion after implementation

For documentation-only changes, run the scoped formatter and diff check:

```bash
pnpm exec oxfmt --check AGENTS.md docs/fetching-layer-compliance-checklist.md
git diff --check -- AGENTS.md docs/fetching-layer-compliance-checklist.md
```

For frontend fetching/persistence changes, run root lint and formatting, `pnpm typecheck:nuxt`, `pnpm test:frontend`, and the applicable package/feature and browser suites. For API or shared-contract changes, the root guide requires:

```bash
pnpm lint
pnpm format:check
pnpm --filter @eve-space/api typecheck
pnpm --filter @eve-space/api test:coverage
pnpm --filter @eve-space/api test:redis
pnpm --filter @eve-space/api test:postgres
pnpm --filter @eve-space/api build
pnpm build
```

Run affected frontend and package suites in addition when a shared contract changes. SDK implementation changes also require the package's `pnpm esi:validate` workflow. Run Sonar only when required by the task, after prerequisite reports exist.

For runtime changes, follow the root deployment check:

```bash
docker compose up -d --build api
docker compose ps
```

Probe representative valid and invalid application routes against the rebuilt runtime. Record method, route, expected/actual status, and relevant authorization/cache behavior. Preserve local database data.

## 9. Design improvements to assess separately

These are design recommendations, not additional repository requirements. Report opportunities separately from compliance failures unless an adopted specification makes them mandatory.

- **End-to-end freshness:** Does a new browser `staleTime` unintentionally extend an upstream freshness claim? Trace an example where ESI expires at 12:05, the API serves a cache hit at 12:04, and the browser waits another five minutes. Consider application freshness metadata or remaining-lifetime policy where the product needs tighter freshness; no particular DTO shape is mandated.
- **Interface depth:** Can a feature obtain an authorized resource and its presentation state without learning storage sequencing, admission timers, or retry internals? Prefer one behavior-owning module over many pass-through wrappers.
- **Policy locality:** Can a maintainer find a resource's identity, access policy, refresh policy, and invalidation behavior without reconciling duplicated declarations?
- **Measured storage cost:** Are snapshot size, write latency, and startup restoration cost bounded and measured? Choose storage and serialization from actual needs; neither IndexedDB nor a custom codec is inherently required.

## Report template

```markdown
# Fetching compliance review

## Scope

- Commit and relevant working-tree state:
- Request paths / features reviewed:
- Governing instructions and specifications:

## Request inventory

[Completed inventory table]

## Results

| Check ID | PASS / FAIL / BLOCKED / N/A | Implementation evidence | Test or probe evidence / reason |
| -------- | --------------------------- | ----------------------- | ------------------------------- |

## Findings

### [Check ID] Short title

- Impact and triggering scenario:
- Governing rule:
- Evidence (`path:line`; include final route/middleware for access findings):
- Expected versus observed behavior:
- Smallest proposed correction:

## Policy conflicts and missing evidence

- Conflicting rule/specification/implementation references:
- Decision or environment needed:

## Verification

| Exact command / probe | Exit status or result | Log / evidence path |
| --------------------- | --------------------- | ------------------- |

## Optional design opportunities

[Keep recommendations distinct from required corrections]

## Conclusion

[Compliant within the stated scope / non-compliant / inconclusive]
[Unreviewed paths and blocked evidence; no whole-codebase claim from a partial review]
```

## Library references

- [Official cache persister](https://pinia-colada.esm.dev/plugins/official/cache-persister.html)
- [Cache persistence cookbook](https://pinia-colada.esm.dev/cookbook/cache-persistence.html)
- [Pinia Colada Nuxt integration](https://pinia-colada.esm.dev/nuxt.html)
- [Local SDK contract](../packages/esi-client/README.md)

The persister documents successful-result persistence, filtering, debounced writes, asynchronous readiness, original query timestamps, and best-effort storage failures. It does not establish application authorization policy. Consult documentation for the installed version when evaluating plugin behavior; use Context7 for library-specific questions and the local SDK documentation for this workspace's SDK contract.
