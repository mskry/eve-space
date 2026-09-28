# Fetching compliance review: reviewer character landing

## Scope

- Commit `9a8275e4`, branch `fix/eve-16-reviewer-evidence-seam`, uncommitted OpenSpec change
  `add-reviewer-character-directory-and-read-only-landing`.
- Changed browser requests: platform reviewer entry, character directory, account and exact-character
  target, Member Audit profile and current-observation panels, and account block/unblock commands.
  Reviewed the associated scheduled ship/location resources and canonical profile product.
- Governing policy: root and scoped `AGENTS.md`, the four delta specifications in the OpenSpec
  change, [operation review](member-audit-operation-review.md), and
  [fetching-layer checklist](fetching-layer-compliance-checklist.md). This is a scoped report;
  unchanged ESI gateway, official browser persister, and unrelated owner features were not
  re-audited in full.

## Request inventory

All browser requests use the credentialed application client. The root mount is
`api/src/index.ts:55-73`: credentialed CORS is limited to `WEB_ORIGIN`, Hono CSRF is global,
the reviewer router mounts at `/api/organization/review`, feature routers at `/api/modules`, and
owner routes at `/api/me/characters`.

| Consumer / query                               | Key / triggering inputs                                                                                               | Trigger / SSR                                   | Final method and authorization                                                                                                                                                                                          | ESI / retention                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `app/queries/organization-review.ts:49` entry  | Private reviewer entry                                                                                                | Client-only authenticated query                 | `GET /api/organization/review`; `privateNoStore`, session, organization, contribution reviewer gate in `api/src/platform/organization-review-routes.ts:71-79,202-238`                                                   | No ESI; memory-only.                                                               |
| `organization-review.ts:67` directory          | Organization version, normalized filters, sort, cursor and limit in `query-keys.ts:127-144`                           | Client-only after entry                         | `GET /api/organization/review/characters`; same mount plus search and summary permission at `organization-review-routes.ts:101-124,183-200`                                                                             | Database aggregates only; memory-only.                                             |
| `organization-review.ts:115` target            | Organization version, account, exact character, current managed lifecycle                                             | Client-only after entry and URL selection       | `GET /api/organization/review/members/:userId/characters/:characterId` or legacy account lookup; same mount and exact resolver at `organization-review-routes.ts:125-180`                                               | No ESI; memory-only.                                                               |
| `MemberAuditCharacterOverviewPanel.vue:15-35`  | Module/route, organization, account, character/lifecycle/generation and overview activation in platform protected key | Client-only, admitted landing only              | `GET /api/modules/member-audit/accounts/:userId/characters/:characterId/overview`; module/section, session, organization, reviewer permission, exact target and post-read gate at `module-route-composition.ts:174-251` | Route-only `public-character-profile` canonical product; memory-only.              |
| `MemberAuditCurrentObservationPanel.vue:16-38` | Separate current-observation activation/disclosure key                                                                | Client-only, independent permission and section | `GET /api/modules/member-audit/accounts/:userId/characters/:characterId/current-observation`; same target gate plus content-free audit-before-evidence, attested read and post-read authority                           | Stored ship/location snapshots only; zero expired-evidence allowance, memory-only. |
| `member-block.vue:52-87`                       | Confirmed organization version, managed lifecycle, account and reason                                                 | Browser form submit only                        | `POST`/`DELETE /api/modules/member-audit/accounts/:userId/block`; access-management, exact block permission and current target; command transaction compares confirmed context before mutation                          | No ESI; account-wide private admission transition after success.                   |

Owner `GET /api/me/characters/:characterId` remains behind `loadSession` and
`loadOwnedCharacter` in `api/src/characters/core-routes.ts:103-110`; no reviewer panel calls it.
Profile source publicity does not change either application's session gate.

## Results

`PASS` applies only to the request and resource paths above. `N/A` means the check addresses a
separate unchanged mechanism, not that the mechanism is universally compliant.

| Check ID   | Result | Implementation and test evidence / reason                                                                                                                                                                                                                                                                                   |
| ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-01     | PASS   | Module panels use `usePlatformApi` and protected queries; credentials, ESI and persistence remain host/server-owned. Module conformance passes.                                                                                                                                                                             |
| MOD-02     | N/A    | SDK attempt/deadline/response-body internals are unchanged by the refreshed generated operation snapshot; `pnpm esi:validate` passes.                                                                                                                                                                                       |
| MOD-03     | PASS   | `current-observation-resources.ts` declares platform dispatch only; core operations bind generated descriptors. `verify-esi-egress` and module conformance pass.                                                                                                                                                            |
| MOD-04     | PASS   | `public-character-profile-adapter.ts` delegates to canonical `characters/profile.ts`; current ship/location map bounded canonical projections. Product and operation-policy tests pass.                                                                                                                                     |
| MOD-05     | PASS   | New queries explicitly use `esiPersistence: none`; organization transition uses the root query-persistence runtime through the platform invalidation callback.                                                                                                                                                              |
| MOD-06     | PASS   | One platform landing resolver supplies independently bound panels; browser panels do not duplicate target policy. Resolver, package and browser tests pass.                                                                                                                                                                 |
| AUTH-01    | PASS   | Final Hono mounts and section/permission chain are listed in the inventory; mounted route tests exercise denial.                                                                                                                                                                                                            |
| AUTH-02    | PASS   | `organization-review.ts` uses `import.meta.client`; feature panels use client-only `usePlatformProtectedQuery`; production browser SSR emits no protected fetch.                                                                                                                                                            |
| AUTH-03    | PASS   | Retry/refetch remains behind the same query access and mounted route. Block/unblock is a browser-only form mutation; no SSR prefetch.                                                                                                                                                                                       |
| AUTH-04    | PASS   | Direct owner route still applies ownership; reviewer target is separately exact-resolved, not owner-authorized. Browser test asserts no owner-target request.                                                                                                                                                               |
| AUTH-05    | PASS   | Entry, target, module and command gates require current organization/reviewer audience, permission and binding. Hono and PostgreSQL stale-confirmation tests pass.                                                                                                                                                          |
| AUTH-06    | PASS   | Workspace hides stale target data while lookup changes; resolver removes denied observation independently; browser slow-read, logout and admission-loss regressions pass.                                                                                                                                                   |
| AUTH-07    | PASS   | Credentialed client, `WEB_ORIGIN` CORS, no tokens in DTOs/jobs/keys; local unauthenticated directory returns `private, no-store`.                                                                                                                                                                                           |
| QUERY-01   | PASS   | Directory key covers every filter/cursor/limit; target and feature keys include current organization and exact binding. Unit and workspace tests pass.                                                                                                                                                                      |
| QUERY-02   | PASS   | Reviewer results are memory-only and guarded by verified organization readiness and owner-bound private lifecycle. Browser storage regression checks local/session storage and IndexedDB for observation facts.                                                                                                             |
| QUERY-03   | PASS   | Exact target lookup precedes rendering; panel host keys include target authority; superseded reads cannot populate the next target. Browser switching test passes.                                                                                                                                                          |
| QUERY-04   | PASS   | ESI wire validation stays SDK-owned; Hono validates input; browser responses use `AppType` inference without claiming runtime client validation.                                                                                                                                                                            |
| QUERY-05   | PASS   | Chained Hono route definitions, `zValidator` and explicit JSON statuses; route tests cover invalid cursor/target and command preconditions.                                                                                                                                                                                 |
| QUERY-06   | PASS   | Block command transitions organization private queries/admission, then re-verifies; two sibling rows update in browser fixture.                                                                                                                                                                                             |
| TIME-01    | PASS   | Gateway response expiry remains authoritative; profile preserves original cache metadata and each observation is classified at upstream expiry. Controlled-clock and gateway policy tests pass.                                                                                                                             |
| TIME-02    | PASS   | Generated operations retain ETag/Last-Modified conditional support; existing gateway tests exercise `304` and cache metadata. No new transport path.                                                                                                                                                                        |
| TIME-03    | N/A    | New reviewer results are never browser-persisted; validation timestamps are not refreshed on cache hits.                                                                                                                                                                                                                    |
| TIME-04    | PASS   | `MemberAuditCharacterOverviewPanel.vue` derives stale presentation from server profile metadata, retaining content with the original validation time, failure reason and retry deadline. `member-audit-panels.nuxt.test.ts` covers cooldown, outage, invalid response and unknown failure, plus authority-state precedence. |
| TIME-05    | PASS   | Private generation-bound gateway policy is unchanged; observation's reviewed stale allowance is zero. No expired evidence release.                                                                                                                                                                                          |
| TIME-06    | PASS   | Snapshot read checks upstream expiry and 24-hour ceiling; panel deadline timer removes current evidence without another fetch.                                                                                                                                                                                              |
| TIME-07    | PASS   | Observation reads never schedule ESI; resource scheduling owns cadence. Disabled section has zero local collection rows.                                                                                                                                                                                                    |
| PERSIST-01 | PASS   | Directory, target, profile, observation, and command results declare no ESI persistence.                                                                                                                                                                                                                                    |
| PERSIST-02 | N/A    | No new official persister integration; all reviewer query results are excluded.                                                                                                                                                                                                                                             |
| PERSIST-03 | N/A    | No new stored reviewer envelope is parsed or restored.                                                                                                                                                                                                                                                                      |
| PERSIST-04 | N/A    | No reviewer storage restoration or hydration release path.                                                                                                                                                                                                                                                                  |
| PERSIST-05 | PASS   | Existing verified owner and current organization admission gate private queries.                                                                                                                                                                                                                                            |
| PERSIST-06 | PASS   | Logout, owner change and denied admission close reviewer presentation in browser tests; block transitions organization admission.                                                                                                                                                                                           |
| PERSIST-07 | PASS   | Host transition cancels/removes organization queries; slow target-switch tests reject late results.                                                                                                                                                                                                                         |
| PERSIST-08 | N/A    | No new cross-tab persisted reviewer state; existing lifecycle notifications remain unchanged.                                                                                                                                                                                                                               |
| PERSIST-09 | N/A    | No new reviewer browser storage or restoration failure path.                                                                                                                                                                                                                                                                |
| PERSIST-10 | PASS   | Suspended organization verification closes retained private presentation; new reviewer results are never persisted.                                                                                                                                                                                                         |
| ESI-01     | PASS   | `member-audit-operation-review.md` records official paths, scopes, resolved compatibility date and `char-location` rate group; SDK, catalog and startup policy validation pass.                                                                                                                                             |
| ESI-02     | PASS   | Existing gateway user-agent, compatibility and SDK response validation policy is reused; SDK validation passes.                                                                                                                                                                                                             |
| ESI-03     | PASS   | Cache and coordination Redis responsibilities remain separate; thresholded Redis suite passes.                                                                                                                                                                                                                              |
| ESI-04     | PASS   | Gateway cache identity and request collapse remain unchanged; API gateway policy and Redis tests pass.                                                                                                                                                                                                                      |
| ESI-05     | PASS   | Canonical profile product propagates request abort; scheduled resources inherit gateway deadlines and full-body permits. Product and gateway tests pass.                                                                                                                                                                    |
| ESI-06     | PASS   | Shared route-group and legacy error-budget cooldowns remain gateway-owned; policy/Redis tests pass. Rate-cost capacity remains unaccepted.                                                                                                                                                                                  |
| ESI-07     | PASS   | Browser queries retry zero; block mutation is not generically retried; server gateway owns its own retry budget.                                                                                                                                                                                                            |
| ESI-08     | N/A    | Ship/location/profile operations are unpaginated. Character directory uses distinct encrypted SQL keyset cursors tested across pages, not ESI `before`/`after`.                                                                                                                                                             |
| ESI-09     | N/A    | No `PostUniverseNames`/`PostUniverseIds` path added by this feature.                                                                                                                                                                                                                                                        |
| ESI-10     | PASS   | Gateway safe failures and cooldown metadata remain centralized; profile and observation routes return bounded application states, never raw ESI errors or token values.                                                                                                                                                     |

## Findings

No confirmed violation in the scoped implementation after correction. The reviewer directory and
observation may be enabled only after the separate capacity/privacy gates. Authenticated isolated
fixture probes establish successful directory, exact-target and block-state admission alongside
invalid-input and stale-confirmation denials. A synthetic-character public profile was not fetched
from ESI, and current-observation remains disabled.

## Policy conflicts and missing evidence

- No unresolved conflict between the zero-stale deployment decision, the five-second operation
  cache declarations, and the 24-hour maximum retention: expiry always wins for evidence release.
- Representative enabled workload metrics and valid profile/observation reads against a
  controlled SSO-authorized development character are missing. The
  [verification and capacity record](reviewer-character-landing-verification.md) records the
  authenticated isolated-fixture probes and marks remaining acceptance evidence **BLOCKED**.
  The user chose to keep the section disabled rather than accept unmeasured capacity. Any later
  development enablement requires measured capacity and exact-character disclosure, followed by
  separate production privacy acceptance.

## Verification

Review-fix verification: `pnpm exec vitest run --config vitest.ui.config.ts
tests/organization/organization-review-workspace.nuxt.test.ts
tests/organization/member-audit-panels.nuxt.test.ts` passed all 50 tests
(`/tmp/eve-review-regressions.log`). `pnpm typecheck:nuxt:local` passed
(`/tmp/eve-review-typecheck.log`). Scoped `oxlint` and `oxfmt --check` passed, as did
`pnpm exec tsx` for `scripts/verify-nuxt-module-boundaries.ts`,
`scripts/verify-esi-query-persistence.ts`, and `scripts/verify-query-persistence-boundaries.ts`.
The fix changes presentation only; the profile request, client-only admission, and final
session/reviewer/section/target middleware listed above remain unchanged.

Exact commands, pass/fail results, Testcontainers/browser coverage and log paths are recorded in
[reviewer character landing verification](reviewer-character-landing-verification.md). Relevant
passes include `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:frontend`,
`pnpm test:modules`, `pnpm test:registry`, API coverage/Redis/PostgreSQL, `pnpm esi:validate`,
API/Nuxt builds, the production-server browser journey, and authenticated isolated-fixture
probes. Enabled-observation capacity checks remain blocked as above.

## Design refactor verification — 2026-09-28

This follow-up covers the uncommitted refactor on `9a8275e4`: declared resource freshness,
declared reviewer directory actions, and character-directory tests through the production
`searchManagedOrganizationCharacters` interface. The request inventory above remains applicable.
No request, query key, persistence category, ESI operation, or authorization gate was added.

| Check ID                  | Result | Evidence                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MOD-06                    | PASS   | Collection success, eligibility, and directory classification select `representation-expiry` from installed resource declarations. Directory navigation resolves declared actions without feature-specific identifiers.                                                                                      |
| AUTH-01, AUTH-02, AUTH-05 | PASS   | `api/src/index.ts` still mounts `/api/organization/review` with session and organization reviewer gates; workspace queries remain client-only. Directory action metadata must agree between installed and admitted contributions. Mounted route and production-browser tests pass.                           |
| AUTH-06, QUERY-03         | PASS   | Workspace tests exercise permission removal and section/module disablement. The five production reviewer journeys pass with declared action metadata.                                                                                                                                                        |
| TIME-01, TIME-05          | PASS   | Collection-status tests use unrelated module/resource names to verify expiry selection and retain original timestamps across cache hits. PostgreSQL tests verify independent ship/location expiry and the existing 24-hour cap. A familiar resource name without the policy retains interval classification. |
| Other checklist items     | N/A    | This refactor does not change the mechanisms assessed by those items; the preceding review remains their evidence.                                                                                                                                                                                           |

Character pagination, cursor tampering/filter mismatch, lifecycle changes, and eligibility also
pass through the public directory result in the PostgreSQL suite.

No additional policy conflict was found. The earlier live enabled-observation capacity and privacy
acceptance limitations remain; these checks neither enable the section nor claim that acceptance.

All commands below completed with exit status 0. Logs use the prefix
`/private/tmp/eve-design-`. Initial sandbox failures involving local sockets or Docker were rerun
with the required access. The interrupted browser process was stopped and rerun successfully.

| Command or probe                                                                                                                                       | Result                                                   | Log suffix                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------- |
| `pnpm lint`                                                                                                                                            | All repository checks pass                               | `lint.log`                                     |
| `pnpm format:check`                                                                                                                                    | Pass                                                     | `format.log`                                   |
| `pnpm --filter @eve-space/api typecheck`                                                                                                               | Pass                                                     | `api-typecheck.log`                            |
| `pnpm typecheck:nuxt:local`                                                                                                                            | Pass                                                     | `nuxt-typecheck.log`                           |
| `pnpm --filter @eve-space/api test:coverage`                                                                                                           | 2,642 tests pass; coverage thresholds pass               | `api-coverage.log`                             |
| `pnpm --filter @eve-space/api test:redis`                                                                                                              | 52 tests pass; coverage thresholds pass                  | `redis.log`                                    |
| `pnpm --filter @eve-space/api test:postgres`                                                                                                           | 392 tests pass                                           | `postgres.log`                                 |
| `pnpm test:frontend`                                                                                                                                   | 1,033 unit and 285 mounted tests pass                    | `frontend.log`                                 |
| `pnpm exec vitest run --config vitest.registry.config.ts tests/platform/platform-module-registry.test.ts tests/platform/member-audit-adoption.test.ts` | 117 tests pass                                           | `registry-tests.log`                           |
| `pnpm exec vitest run test/reviewer-landing.test.ts` in `packages/platform-module-nuxt`                                                                | Five tests pass, including alternate feature identifiers | `landing-tests.log`                            |
| `pnpm --filter @eve-space/api build`                                                                                                                   | Pass                                                     | `api-build.log`                                |
| `pnpm build`                                                                                                                                           | Pass                                                     | `build.log`                                    |
| `pnpm test:e2e:build`                                                                                                                                  | Pass                                                     | `e2e-build.log`                                |
| `EVE_SPACE_E2E_PERSISTENCE_FIXTURE=1 pnpm exec vitest run --config vitest.e2e.config.ts tests/organization/member-audit-review.e2e.test.ts`            | Five browser journeys pass                               | `reviewer-e2e.log`                             |
| `pnpm lint:quality` after the final fixture update                                                                                                     | Existing baseline fingerprints verified; no new findings | `quality-final.log`                            |
| `docker compose up -d --build api`, then `docker compose ps`                                                                                           | API rebuilt and healthy                                  | `compose-build.log`                            |
| Local `GET /health`, `GET /api/organization/review/characters` without a session, `GET /api/not-a-route`                                               | Expected 200, 401, and 404                               | `health.json`, `denial.json`, `not-found.json` |

The scoped refactor is compliant within this code and test evidence.

## Conclusion

Compliant within the stated code/test scope. Runtime acceptance of an enabled observation
section is inconclusive; no production enablement is implied.
