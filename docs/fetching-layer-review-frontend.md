# Fetching compliance review: Layer 1 — frontend queries

## Recheck completed

See [the current Layer 1 recheck](fetching-layer-review-frontend-recheck.md) for the latest verdict and verification evidence. F1–F4, the persistence allowlist conflict, the later mail-header purge defect, and the platform test-fixture mismatch are resolved in the tested scope.

The original report below is historical. Its findings, policy conflict, request classifications, and failing-test counts describe the earlier working tree and are superseded by the recheck.

## Scope

- Review date: 2026-09-15.
- Base commit: `a254cbd7990e3df43574035c0c28118d13636b3c`.
- Reviewed the working tree, including the uncommitted query-persistence implementation and its entry-state refactor, query classifications, auth verification, recovery hooks, and presentation integration. Findings describe that working state, not the base commit alone.
- Scope: core `app/queries/` definitions, their principal consumers, shared auth/query lifecycle, platform protected-query interface, and browser persistence integration points. API routes were inspected to establish actual authorization; server ESI execution/cache internals remain Layer 2.
- Governing instructions: root `AGENTS.md`, scoped guides for query persistence, platform Nuxt, character/auth/organization routes, and [the fetching compliance checklist](fetching-layer-compliance-checklist.md).
- This is an audit. Application source was not corrected. Temporary diagnostic probes were moved out of the repository after execution.

## Conclusion

**Non-compliant within the reviewed scope.** Four actionable findings are recorded below, plus a persistence-policy conflict and two unresolved test expectations. Fix shared-query reactivity and the session-response race before relying on broader frontend acceptance results.

## Request inventory

Keys are produced by `app/queries/query-keys.ts`. The table identifies the resource-selecting inputs; it does not prescribe a replacement key format. ESI operation/representation mapping is deferred to Layer 2.

| Query / consumer                          | Identity inputs                                                | Trigger and SSR behavior                                                          | Final application route                                           | Mounted access                                            | Persistence declaration            |
| ----------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `authConfigQuery` / `useAuthSession`      | Auth config                                                    | Client mount / initialize                                                         | `GET /auth/config`                                                | Public                                                    | None                               |
| `authSessionQuery` / `useAuthSession`     | Session singleton                                              | Client mount / refresh                                                            | `GET /auth/session`                                               | Cookie-dependent identity; anonymous result allowed       | None                               |
| `auth.global.ts` session verification     | No query key                                                   | Client navigation / post-hydration                                                | `GET /auth/session`                                               | Same session endpoint                                     | None                               |
| `loadCacheAdmission`                      | Verified session                                               | After client session verification                                                 | `GET /api/me/cache-admission`                                     | Application session                                       | Admission is not a persisted query |
| `adminSetupQuery`                         | Setup singleton                                                | Client mount / initialize                                                         | `GET /api/admin/setup`                                            | Public setup status                                       | None                               |
| `adminSessionQuery`                       | Admin session singleton                                        | Client mount                                                                      | `GET /api/admin/session`                                          | Cookie-dependent admin identity; anonymous result allowed | None                               |
| `systemStatusQuery` / shell               | Status singleton                                               | Client shell mount, prefetch, sole polling opt-in; definition supports public SSR | `GET /api/status`                                                 | Public                                                    | None                               |
| `publicTypeDetailQuery` / item popover    | Type ID                                                        | Mount; SSR-capable                                                                | `GET /api/universe/types/:typeId`                                 | Public                                                    | None                               |
| `publicCharacterQuery` / character page   | Character ID                                                   | Client mount; no live-auth gate in page                                           | `GET /api/characters/:characterId`                                | Application session at root mount                         | Public ESI — finding F3            |
| `corporationQuery` / corporation page     | Corporation ID                                                 | Client mount; no live-auth gate in page                                           | `GET /api/corporations/:corporationId`                            | Application session at root mount                         | Public ESI — finding F3            |
| `corporationAllianceHistoryQuery`         | Corporation ID                                                 | Client child mount after player-corporation result                                | `GET /api/corporations/:corporationId/alliance-history`           | Application session at root mount                         | Public ESI — finding F3            |
| `characterRosterQuery` / roster and shell | Private roster singleton                                       | Client verified-auth gate                                                         | `GET /api/me/characters`                                          | Application session                                       | None                               |
| `characterOverviewQuery`                  | Character ID                                                   | Client auth/ownership gate; intent prefetch                                       | `GET /api/me/characters/:characterId`                             | Owned character                                           | Character ESI                      |
| `characterAttributesQuery`                | Character ID                                                   | Client auth/ownership gate; intent prefetch                                       | `GET /api/me/characters/:characterId/attributes`                  | Owned character                                           | Character ESI                      |
| `characterSkillsQuery`                    | Character ID                                                   | Client auth/ownership gate; intent prefetch                                       | `GET /api/me/characters/:characterId/skills`                      | Owned character                                           | Character ESI                      |
| `characterSkillQueueQuery`                | Character ID                                                   | Client auth/ownership gate; intent prefetch                                       | `GET /api/me/characters/:characterId/skill-queue`                 | Owned character                                           | Character ESI                      |
| `characterHistoryQuery`                   | Character ID                                                   | Client auth/ownership gate; intent prefetch                                       | `GET /api/me/characters/:characterId/history`                     | Owned character                                           | Character ESI                      |
| `characterClonesQuery`                    | Character ID                                                   | Client auth/ownership gate; intent prefetch                                       | `GET /api/me/characters/:characterId/clones`                      | Owned character                                           | Character ESI                      |
| `characterImplantsQuery`                  | Character ID                                                   | Client auth/ownership gate; intent prefetch                                       | `GET /api/me/characters/:characterId/implants`                    | Owned character                                           | Character ESI                      |
| `characterAssetsQuery`                    | Character ID                                                   | Client auth/ownership gate                                                        | `GET /api/me/characters/:characterId/assets`                      | Owned character                                           | Character ESI                      |
| `characterAssetRoutesQuery`               | Character, origin, sorted unique destinations, shortest policy | Client auth/ownership gate                                                        | `POST /api/universe/routes`                                       | Public, rate-limited; frontend applies a stronger gate    | None                               |
| `characterFinanceBalanceQuery`            | Character ID                                                   | Client auth/ownership gate; intent prefetch                                       | `GET /api/me/characters/:characterId/wallet`                      | Owned character                                           | Character ESI                      |
| `characterFinanceJournalQuery`            | Character ID, page                                             | Client auth/ownership/requested gate; prefetch                                    | `GET /api/me/characters/:characterId/wallet/journal`              | Owned character                                           | Character ESI                      |
| `characterFinanceTransactionsQuery`       | Character ID, `fromId`                                         | Client auth/ownership/requested gate                                              | `GET /api/me/characters/:characterId/wallet/transactions`         | Owned character                                           | Character ESI                      |
| `characterFinanceOpenOrdersQuery`         | Character ID                                                   | Client auth/ownership/requested gate                                              | `GET /api/me/characters/:characterId/market/orders`               | Owned character                                           | Character ESI                      |
| `characterFinanceOrderHistoryQuery`       | Character ID, page                                             | Client auth/ownership/requested gate                                              | `GET /api/me/characters/:characterId/market/orders/history`       | Owned character                                           | Character ESI                      |
| `characterFinanceContractsQuery`          | Character ID, page                                             | Client auth/ownership/requested gate                                              | `GET /api/me/characters/:characterId/contracts`                   | Owned character                                           | Character ESI                      |
| `characterFinanceContractItemsQuery`      | Character ID, contract ID; request also carries contract page  | Client detail request; guarded imperative refresh                                 | `GET /api/me/characters/:characterId/contracts/:contractId/items` | Owned character; server contract membership validation    | Character ESI                      |
| `characterFinanceContractBidsQuery`       | Character ID, contract ID; request also carries contract page  | Client auction detail request; guarded imperative refresh                         | `GET /api/me/characters/:characterId/contracts/:contractId/bids`  | Owned character; server contract membership validation    | Character ESI                      |
| `mailHeadersQuery`                        | Character ID, normalized labels, last mail ID                  | Client auth/ownership gate; prefetch/pagination                                   | `GET /api/me/characters/:characterId/mail`                        | Owned character                                           | Character ESI                      |
| `mailDetailQuery`                         | Character ID, mail ID                                          | Client auth/ownership gate and selection                                          | `GET /api/me/characters/:characterId/mail/:mailId`                | Owned character                                           | Character ESI                      |
| `mailLabelsQuery`                         | Character ID                                                   | Client auth/ownership gate; shell badge/prefetch                                  | `GET /api/me/characters/:characterId/mail/labels`                 | Owned character                                           | Character ESI                      |
| `mailingListsQuery`                       | Character ID                                                   | Client auth/ownership gate; prefetch                                              | `GET /api/me/characters/:characterId/mail/lists`                  | Owned character                                           | Character ESI                      |
| `resolveMailRecipientsQuery`              | Character ID, normalized name string                           | Composition query                                                                 | `POST /api/me/characters/:characterId/mail/recipients/resolve`    | Owned character                                           | Character ESI                      |
| `searchMailRecipientsQuery`               | Character ID, normalized search                                | Composition query                                                                 | `GET /api/me/characters/:characterId/mail/recipients/search`      | Owned character                                           | Character ESI                      |
| `organizationContextQuery`                | Organization singleton                                         | Client authenticated gate                                                         | `GET /api/organization/context`                                   | Session and current organization context                  | None                               |
| `organizationComplianceQuery`             | Organization singleton                                         | Client authenticated/configured gate                                              | `GET /api/organization/compliance`                                | Session and current organization context                  | None                               |
| `organizationActivitiesQuery`             | Organization singleton                                         | Client authenticated/compliance gate                                              | `GET /api/organization/activities`                                | Session and organization activity access                  | Organization ESI — policy conflict |
| `organizationExceptionsQuery`             | Organization singleton                                         | Client HR capability gate                                                         | `GET /api/organization/exceptions`                                | Session and organization HR                               | None                               |
| `organizationAuditQuery`                  | Organization singleton, before-audit sequence                  | Client HR capability gate / pagination                                            | `GET /api/organization/audit`                                     | Session and organization HR                               | None                               |
| `organizationRolesQuery`                  | Organization singleton                                         | Client organization-owner gate                                                    | `GET /api/organization/roles`                                     | Session and organization owner                            | None                               |
| `organizationRosterCoverageQuery`         | Organization singleton                                         | Client member/roster capability gate                                              | `GET /api/organization/roster-coverage`                           | Session and organization HR                               | Organization ESI — policy conflict |

Other execution interfaces inspected:

- `useAuthSession.logout()` calls `POST /auth/logout` from a browser action; the server deletes the session and cookie (`api/src/auth/routes.ts:278`). Its completion race is F2.
- `useCharacterRoster` uses `PATCH /api/me/characters/:characterId/main` and `DELETE /api/me/characters/:characterId`; it updates roster state and clears removed-character queries.
- `prefetchProtectedQuery` requires client/authentication/ownership, and current private admission before it can reuse retained private data (`app/queries/query-cache.ts:44`). Navigation prefetchers use it. Generic status prefetch targets a genuinely public route.
- `useCharacterFinanceContractDetail.refreshOpenedDetails()` checks protected-character access before imperative cache fetches (`app/composables/useCharacterFinanceContractDetail.ts:163`).
- `installEsiQueryRecovery` invalidates active stale eligible entries after an unavailable-to-operational status transition. Its existing recovery tests ran; exhaustive combinations of disabled observers and admission expiry remain unreviewed.
- The shared `usePlatformProtectedQuery` interface enforces client, authentication, subject, module, and generated-route eligibility. Individual installed-module request/manifest traces remain a later review scope.
- Mail and organization mutation definitions were inspected, but their full optimistic-state and post-authorization-change lifecycle matrices were not audited. They are not included in a compliance pass.

## Findings

### F1 — High: persistence observation causes recursive updates for shared query consumers

- Checks: **MOD-05**, **PERSIST-02**, **PERSIST-04**.
- Evidence: `app/query-persistence/runtime.ts:1080` observes every successful `ensure` and calls `recordSuccessfulCurrentResult`. That function always calls `touchQueryPersistenceState` at line 1119. `app/query-persistence/state.ts:89` reads and increments a reactive revision, even when `entryState.succeeded()` made no change.
- Trigger: mount two consumers of the same query, then resolve the request. Query resolution repeatedly observes and updates reactive persistence state.
- Observed: `query-infrastructure.test.ts:17` makes one network request but renders `sharedloading` instead of `sharedshared`, with `Maximum recursive updates exceeded`. The isolated test reproduces it. Existing protected-character, clone, mail-badge, and DashboardShell tests also fail around shared consumers/recursive updates.
- Expected: both consumers receive the same settled result; merely ensuring an unchanged entry has no observable persistence transition.
- Proposed correction: make observation idempotent and notify presentation only for actual state changes. Avoid introducing a reactive read/write dependency while resolving query entries; exclude ineligible entries where appropriate. Preserve regression coverage for multiple consumers and the shell.

### F2 — High: an older session response can restore authenticated UI state after logout

- Checks: **AUTH-06**, **QUERY-03**, **PERSIST-06**, **PERSIST-07**.
- Evidence: `app/composables/useAuthSession.ts:25` begins verification only after the HTTP request resolves. `useAuthVerification.ts:33` allocates its generation at that completion point. Logout at `useAuthSession.ts:87` settles an anonymous session, but `packages/platform-module-nuxt/src/runtime/query-lifecycle.ts:45` deliberately preserves an in-flight session query when clearing the other entries.
- Mounted route evidence: `/auth/session` reads a session and returns its account at `api/src/auth/routes.ts:266`; `/auth/logout` deletes the bearer record/cookie at line 278, both mounted by `api/src/index.ts:68`.
- Reproduction: authenticate, start a second session request and hold its already-authenticated response, complete logout, make subsequent admission requests return `401`, then release the old session response.
- Observed: `authSession.authenticated` changes from false back to true. The probe still reproduces with the post-logout admission endpoint returning `401`. This proves incorrect browser identity state; it does not restore the deleted server bearer.
- Expected: a response initiated before logout cannot become the current identity after logout.
- Proposed correction: capture the lifecycle generation before each session request, reject superseded responses before identity application and cache commit, and cancel outstanding session verification on logout. Apply the same ordering rule to route-middleware verification, not just Colada requests.

### F3 — High: session-protected lookups are classified and restored as public data

- Checks: **AUTH-01**, **AUTH-03**, **AUTH-06**, **PERSIST-01**, **PERSIST-05**.
- Query evidence: `app/queries/characters.ts:52` and `app/queries/corporations.ts:21`/`:40` use public keys and `public-esi` persistence.
- Consumer evidence: `app/pages/character/[characterId].vue:14`, `app/pages/corporation/[corporationId].vue:15`, and its `alliance-history.vue:11` gate on client execution and record selection/type, without live session verification. They render cached record data directly.
- Mounted route evidence: `api/src/index.ts:59–60` requires `loadSession, requireSession` for these routes. `api/src/middleware/auth-session.ts:20` rejects an anonymous request. Public ESI source data does not change these application-route requirements.
- Persistence evidence: `app/query-persistence/runtime.ts:415` stages public tuples; `applyStagedPublicFallbacks` at line 429 releases them after hydration without owner/admission verification. Private logout clearing targets the private key root (`packages/platform-module-nuxt/src/runtime/query-lifecycle.ts:59`).
- Result: lookup requests can run before live authentication; cached lookup results take the ownerless restoration path and survive private-session clearing. The inspected pages do avoid SSR requests, so this is not an SSR-cookie-forwarding finding.
- Proposed correction: classify these lookups according to the mounted application access requirement, apply a live-session execution/presentation gate, and exclude their persisted results until a policy-approved session-bound category exists. Making the application endpoints genuinely public would be a separate explicit architectural decision.

### F4 — Medium: response-validation failures enter the generic transient retry loop

- Check: **ESI-07**, frontend portion.
- Evidence: `app/utils/colada-options.ts:11` retries every `ApiQueryError` with status at least 500. `api/src/characters/assets-routes.ts:29` returns `502 ESI_RESPONSE_INVALID` for invalid pagination, mounted under the owned-character route at `api/src/index.ts:63`.
- Reproduction: normalize that exact application error through `toApiQueryError`, then evaluate the configured retry predicate. It returns true.
- Expected: an explicit invalid-response classification is not treated as a transient transport failure.
- Proposed correction: inspect stable application error classification before the broad status fallback; retain bounded retries for eligible transient failures. Include an actual invalid-response query case in the retry behavior suite.
- The server-side retry budget and cooldown enforcement remain Layer 2; this finding does not claim the browser retry necessarily causes another ESI exchange.

## Policy conflicts and missing evidence

### Persistence allowlist conflict

Root `AGENTS.md:211–213` limits browser persistence to owner-bound character queries. The current implementation additionally declares public lookup persistence and organization activities/roster coverage persistence (`app/queries/organization.ts:65`, `:148`; `packages/platform-module-nuxt/src/runtime/esi-query-persistence.ts:15`). The envelope serializer accepts those categories.

This is a **FAIL against the current written allowlist**, independent of whether their admission mechanisms otherwise work. Resolve the intended scope explicitly before accepting the implementation. F3 additionally describes an application-session mismatch that widening the allowlist alone would not fix.

### Unresolved test expectations

- `tests/queries/query-persistence-runtime.test.ts:126`: the expired-during-hydration case correctly has no query data, but reports `retainedPrivateAccess: false` where the test expects true. The intended presentation contract needs reconciliation; no access leak was established by this failure.
- `packages/platform-module-nuxt/test/query-persistence-presentation.test.ts:40`: expected restored presentation, received fresh during SSR. The injection/test arrangement needs investigation before classifying it as a production defect.
- An exploratory mailbox-copy purge probe encountered recursive updates before reaching its purge assertion. It is inconclusive, not evidence of a separate mail leak. Audit local mail headers and accumulated HR audit arrays after F1 is corrected, since clearing the query cache alone does not prove their lifecycle behavior.
- Production-browser hydration, suspended-tab behavior, installed-module route traces, complete mutation/context-switch journeys, and server authorization-generation/freshness internals remain unreviewed. Unit/component results are not production-browser evidence.

## Checklist results

These statuses apply only to the scope described above. Unlisted checks are deferred, not implicitly passed.

| Check                   | Status  | Evidence / limitation                                                                                                                          |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-01                  | PASS    | Core query definitions use application clients and inferred DTOs; ESI protocol behavior stays across the server interface                      |
| MOD-05                  | FAIL    | Consumer import boundaries pass, but runtime integration fails shared-query behavior: F1                                                       |
| MOD-06                  | BLOCKED | Shared gates and policies exist; complete duplication/control-flow assessment not performed                                                    |
| AUTH-01                 | FAIL    | Final-route classification mismatch: F3                                                                                                        |
| AUTH-02                 | PASS    | Inspected page/composable paths disable protected SSR; genuinely public status/type requests are permitted; SSR/auth unit cases passed         |
| AUTH-03                 | FAIL    | Protected intent prefetch is guarded; lookup mount/recovery access classification remains wrong: F3                                            |
| AUTH-04                 | PASS    | Inspected character routes compose input validation, session loading, and owned-character middleware before resource reads                     |
| AUTH-05                 | BLOCKED | Core organization route gates inspected; complete version-change and installed-module behavior deferred                                        |
| AUTH-06                 | FAIL    | F2 and F3; local-copy presentation still needs follow-up                                                                                       |
| AUTH-07                 | PASS    | Application client uses credentialed Hono infrastructure; root API CORS is restricted to `WEB_ORIGIN`                                          |
| QUERY-01                | BLOCKED | Principal key inputs inventoried; organization singleton/version semantics and all recipient-normalization edge cases need additional evidence |
| QUERY-02                | BLOCKED | Ordinary owner transitions have passing tests; full isolation cannot be signed off with F2/F3                                                  |
| QUERY-03                | FAIL    | Old session completion crosses a logout transition: F2                                                                                         |
| QUERY-04                | PASS    | `app/utils/api-client.ts:1` consumes `AppType`; query DTOs use `InferResponseType`                                                             |
| QUERY-05                | PASS    | Inspected routes retain chained definitions and repository validation middleware                                                               |
| QUERY-06                | BLOCKED | Roster invalidation inspected; full mail/organization mutation lifecycle deferred                                                              |
| TIME-03                 | BLOCKED | Existing retention tests mostly pass; expired-hydration presentation expectation remains unresolved                                            |
| TIME-04                 | BLOCKED | Presentation integration exists, but shell and platform presentation tests fail                                                                |
| TIME-06                 | BLOCKED | Admission/presentation tests do not all pass; full persistence internals are the next frontend sublayer                                        |
| TIME-07                 | PASS    | Auto-refetch allowlist verifier and recovery tests pass for their covered transitions                                                          |
| PERSIST-01              | FAIL    | Public and organization persistence exceed the root allowlist                                                                                  |
| PERSIST-02              | FAIL    | Official plugin integration exists, but shared-query observation is not safe: F1                                                               |
| PERSIST-04              | FAIL    | Shared-query/shell recursive updates; production hydration remains unverified                                                                  |
| PERSIST-05              | FAIL    | Session-protected lookup data uses ungated public restoration: F3                                                                              |
| PERSIST-06 / PERSIST-07 | FAIL    | Logout succeeds but stale session completion restores authenticated browser state: F2                                                          |
| ESI-07                  | FAIL    | Invalid-response retry classification: F4; server budget review deferred                                                                       |

## Verification

Logs and temporary probe source are under `/var/folders/y0/8p43tkrn7rz1f8jlttdq2c900000gn/T/opencode/`. These are local artifacts; the reproduction descriptions above are the durable record. Commands used Corepack-managed pnpm. Package builds completed sequentially before tests.

| Command (each prefixed with `corepack`)                                                                                                                                                                                     | Result                                                                            | Log basename                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| `pnpm --filter @eve-space/platform-module-contract build`                                                                                                                                                                   | Passed                                                                            | `fetching-layer1-contract-build.log`     |
| `pnpm --filter @eve-space/platform-module-nuxt build`                                                                                                                                                                       | Passed                                                                            | `fetching-layer1-nuxt-package-build.log` |
| `pnpm exec tsx scripts/verify-query-persistence-boundaries.ts`                                                                                                                                                              | Passed                                                                            | `fetching-layer1-boundaries.log`         |
| `pnpm exec tsx scripts/verify-esi-query-persistence.ts`                                                                                                                                                                     | Passed                                                                            | `fetching-layer1-boundaries.log`         |
| `pnpm exec vitest run --config vitest.config.ts tests/queries tests/auth tests/mail tests/assets/character-assets-query.test.ts tests/platform/query-persistence-boundaries.test.ts`                                        | **5 failed / 300 passed**, 5 failing files; recursive-update errors also reported | `fetching-layer1-unit.log`               |
| `pnpm --filter @eve-space/platform-module-nuxt exec vitest run test/runtime.test.ts test/runtime-composables.test.ts test/query-persistence-presentation.test.ts`                                                           | **1 failed / 16 passed**                                                          | `fetching-layer1-platform.log`           |
| `pnpm exec vitest run --config vitest.ui.config.ts tests/ui/dashboard-shell.nuxt.test.ts tests/ui/esi-resource-boundary.nuxt.test.ts tests/ui/app-platform-identity.nuxt.test.ts tests/ui/app-upstream-notice.nuxt.test.ts` | **2 failed / 15 passed**; recursive-update errors also reported                   | `fetching-layer1-ui.log`                 |
| `pnpm exec vitest run --config vitest.config.ts tests/queries/query-infrastructure.test.ts -t "deduplicates consumers and reuses fresh data"`                                                                               | Isolated F1 reproduction: **1 failed**, 14 unselected tests                       | `fetching-layer1-dedup-isolated.log`     |
| `pnpm exec vitest run --config vitest.config.ts tests/queries/fetching-layer1-review.probe.test.ts`                                                                                                                         | Two diagnostic assertions failed, confirming F2 and F4                            | `fetching-layer1-confirmed-probes.log`   |

The final temporary probe source is `fetching-layer1-review.probe.test.ts` in the same log directory. To reproduce, restore it to its original `tests/queries/` location; its relative imports assume that location. It is not part of the repository test suite. The earlier `fetching-layer1-probes.log` contains the inconclusive mailbox probe and must not be counted as another confirmed finding.

## Optional design opportunities

- Separate persistence eligibility from query residency configuration: `defineEsiQueryOptions` currently overrides eligible queries' `gcTime` to 24 hours. Document this deliberately so `QUERY_POLICY` does not appear to control a duration that is replaced later.
- Put live-session lookup gating behind one reusable query interface so pages cannot accidentally treat an ESI-public resource as application-public.
- Evaluate server-to-browser freshness metadata in Layer 2 before changing browser `staleTime`; no particular response envelope is required by this review.

## Next checkpoint

Correct and reverify F1/F2 first, resolve lookup classification and the persistence allowlist, and correct retry classification. Then complete the browser persistence/admission lifecycle sublayer before proceeding to server resource caching and ESI execution. Keep the unresolved test expectations and local-copy purge scenarios on that follow-up scope.
