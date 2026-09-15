# Fetching compliance recheck: Layer 1 — frontend queries

## Conclusion

**Layer 1 is compliant within this recheck's stated scope.** The four findings from the [initial review](fetching-layer-review-frontend.md), the copied-mail-header follow-up, and the platform reader fixture mismatch are resolved in the tested scope. The updated persistence policy also resolves the original allowlist conflict.

Final focused verification passes: **501 frontend tests across 44 files**, **19 UI tests across 4 files**, and **18 platform tests across 3 files**. Broader private-presentation and context-switch journeys listed below remain deferred and are not implied to pass by this scoped conclusion.

## Scope and policy

- Date: 2026-09-15; original base commit `a254cbd7990e3df43574035c0c28118d13636b3c`; final recheck commit `c59b840223a08a6f33106240eb229cd4549aca95`.
- Reviewed the corrected persistence implementation, including the extracted `private-lifecycle.ts`, entry-state changes, live-session lookup gates, retry correction, mail consumer invalidation, reactive platform reader fixture, and regression tests.
- Governing rules: root `AGENTS.md`, `app/query-persistence/AGENTS.md`, the platform Nuxt scoped guide, and the [fetching checklist](fetching-layer-compliance-checklist.md).
- Public, character, and organization ESI persistence are now permitted when explicitly classified. Public persistence still requires a genuinely public application route. Private persistence remains owner/admission-bound; session and authorization decisions remain excluded.
- This recheck covers the prior findings, their affected query consumers, the refactored persistence integration, and the previously blocked mail-copy purge scenario. It is not a full server-cache, installed-module, or production-browser audit.
- This final report update did not change application code. The corrected behaviors are covered by repository tests rather than external diagnostic probes.

## Request inventory updates

The initial inventory remains the request-discovery reference. These rows replace its outdated lookup/persistence classifications; final API access requirements were rechecked at `api/src/index.ts:61–70`.

| Request / interface          | Current identity and trigger                                                                                               | Final route / access                                                         | Current persistence                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| Character record lookup      | `PRIVATE_QUERY_KEYS.characterRecord(id)`; client, verified session, valid ID; data presentation also gated                 | `GET /api/characters/:characterId`; application session                      | None                                           |
| Corporation record lookup    | `PRIVATE_QUERY_KEYS.corporationRecord(id)`; client, verified session, valid ID; data presentation also gated               | `GET /api/corporations/:corporationId`; application session                  | None                                           |
| Corporation alliance history | Private corporation/history key; inherited record-access gate and player-corporation selection                             | `GET /api/corporations/:corporationId/alliance-history`; application session | None                                           |
| Organization activities      | Existing organization key; client authentication/compliance gate                                                           | `GET /api/organization/activities`; organization activity access             | Organization ESI; category now policy-approved |
| Organization roster coverage | Existing organization key; client member/HR capability gate                                                                | `GET /api/organization/roster-coverage`; organization HR                     | Organization ESI; category now policy-approved |
| Session verification         | Request-start generation plus cancellation/supersession checks                                                             | `GET /auth/session`; cookie-dependent identity                               | None                                           |
| Logout                       | Advances verification generation and cancels session work before/after logout completion                                   | `POST /auth/logout`; deletes server session and cookie                       | None                                           |
| Mail headers                 | Character ID, normalized labels, cursor; client auth/ownership gate; local copied state subscribes to private invalidation | `GET /api/me/characters/:characterId/mail`; owned character                  | Character ESI; copied state purged with scope  |

The lookup query declarations are at `app/queries/characters.ts:52` and `app/queries/corporations.ts:21–54`. Their live-session execution and presentation gates are in `app/pages/character/[characterId].vue:13–22`, `app/pages/corporation/[corporationId].vue:14–23`, and its `alliance-history.vue:10–33`.

## Previously reported findings

| Finding                                    | Current result                                       | Implementation and verification evidence                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1: recursive shared-query updates         | Resolved in tested scope                             | `app/query-persistence/runtime.ts:1107–1195` filters persistence eligibility and only publishes actual success-state changes. Shared-query, clone, mail-badge, and DashboardShell cases now pass.                                                                                                                                                                                                       |
| F2: old session response reverses logout   | Resolved for the reproduced race                     | `useAuthSession.ts:26–46` captures generation before fetching; `useAuthVerification.ts:54–65` checks supersession before and after admission; logout at `useAuthSession.ts:90–115` advances generation and cancels session work. `tests/queries/private-query-lifecycle.test.ts:279` verifies a pre-logout response cannot restore identity. Route middleware also captures a request-start generation. |
| F3: protected lookup persisted as public   | Resolved for current query definitions and consumers | Lookups use private non-persisted keys and live-session execution/presentation gates. API root mounts still require a session. Classification, SSR/auth, and record-navigation checks pass.                                                                                                                                                                                                             |
| F4: invalid-response retry                 | Resolved for `ESI_RESPONSE_INVALID`                  | `app/utils/colada-options.ts:13–15` rejects the stable error code before the 5xx fallback; the corresponding retry regression at `tests/queries/query-infrastructure.test.ts:131` passes.                                                                                                                                                                                                               |
| Character-only persistence policy conflict | Resolved                                             | `AGENTS.md:211–213` now explicitly permits public, character, and organization ESI categories with their respective restrictions.                                                                                                                                                                                                                                                                       |
| Expired-during-hydration expectation       | Resolved                                             | The test now expects no data and no retained access after the tuple expires. `tests/queries/query-persistence-runtime.test.ts:126` passes.                                                                                                                                                                                                                                                              |
| Mid-refactor `now is not a function` error | No longer reproduced                                 | `initializeQueryCacheHooks` consistently takes `(state, privateLifecycle, now, timers)` at `app/query-persistence/runtime.ts:1086–1091`; the repository frontend suites pass.                                                                                                                                                                                                                           |
| F5: copied mail headers survive purging    | Resolved in tested scope                             | Header-query removal clears the mailbox copy and pagination/selection state. The mail route also subscribes its mailbox, mutation, organization, and composition state to authoritative private invalidation. The mailbox and persistence-runtime regressions pass.                                                                                                                                     |
| Platform reactive reader fixture mismatch  | Resolved                                             | The fixture now accepts `MaybeRefOrGetter<EntryKey>` and derives its result with `computed` plus `toValue`. All 18 selected platform tests pass.                                                                                                                                                                                                                                                        |

## Resolved follow-up: copied mail headers are purged with private cache data

- Checks: **AUTH-06**, **QUERY-03**, **PERSIST-06**, **PERSIST-07**.
- Governing rule: invalidation must remove affected private in-memory data and close its presentation. A cleared query cache alone is insufficient when consumers keep private copies.
- Source correction: `app/composables/useCharacterMailbox.ts:238–252` resets copied headers, pagination, selection, and private view filters. Its header-data watcher at lines 290–305 invokes that reset when authoritative query data disappears, so same-character cache purging no longer leaves `loadedHeaders` visible.
- Consumer correction: `app/pages/characters/[characterId]/mail.vue:49–61` subscribes the current character scope to private invalidation and resets mailbox, mutation, organization, and composition state together.
- Mounted access: `api/src/index.ts:66` mounts `mailRoutes` at `/api/me/characters`; `api/src/mail/routes.ts:126–134` validates input and applies session loading and owned-character middleware before reading mail. The browser copy contains protected character data.
- Verification: `tests/mail/character-mailbox.test.ts:189–240` clears copied headers, pagination, selection, and filters when query data is purged. `tests/queries/query-persistence-runtime.test.ts:1413–1457` verifies observed invalidations purge protected queries and notify matching consumer state. Mail composition and label-management suites exercise their invalidation subscriptions.
- Result: **resolved in the tested scope**. Intentional state retention during an authorized background refresh remains separate from authoritative cache purging and does not trigger the consumer reset.
- Verification limit: this remains unit and mounted-composable evidence, not a production-browser cross-tab journey.

## Resolved platform test-fixture mismatch

`packages/platform-module-nuxt/test/query-persistence-presentation.test.ts:29–32` now implements the declared `PlatformQueryPersistenceReader` contract. It accepts `MaybeRefOrGetter<EntryKey>` and calls `toValue(queryKey)` inside a computed result, so changing the supplied ref updates the presentation from `fresh` to `restored`.

The production host in `app/app.vue:12` forwards the reactive key to `readQueryPersistenceState`, which calls `toValue(key)` inside a computed at `app/query-persistence/runtime.ts:441–456`. The corrected repository fixture exercises the same reactive-key transition.

The corrected fixture asserts the production contract directly. All 18 selected platform tests now pass, so no open production-interface finding remains from this mismatch.

## Current checklist results

Results are limited to the evidence below. Unlisted server-layer checks and untested browser journeys remain deferred.

| Checks                 | Result                                | Evidence / limitation                                                                                                                                         |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-01, MOD-05         | PASS                                  | Typed application-query interface preserved; scoped persistence import checks and shared-consumer regressions pass                                            |
| AUTH-01, AUTH-02       | PASS for inspected paths              | Mounted route classification and client/SSR gates now agree; focused auth and lookup checks pass                                                              |
| AUTH-03                | PASS for tested paths                 | Protected intent-prefetch and existing recovery tests pass; exhaustive background-event combinations deferred                                                 |
| AUTH-06, QUERY-03      | PASS for tested paths                 | Session-response ordering and mail consumer-state purge regressions pass                                                                                      |
| QUERY-01, QUERY-02     | BLOCKED for complete sign-off         | Principal identities and ordinary owner changes tested; complete organization-version, local-copy, and context-switch audit remains broader than these checks |
| QUERY-04, QUERY-05     | PASS for inspected contracts          | `AppType` inference and existing mounted-route structure preserved                                                                                            |
| QUERY-06               | BLOCKED                               | Full mail/organization mutation and authorization-change lifecycle still needs review                                                                         |
| TIME-03                | PASS for covered persistence cases    | Retention, local-write, original-time, and expired-hydration tests pass                                                                                       |
| TIME-04                | PASS for inspected integrations       | Shared UI and corrected reactive platform presentation tests pass                                                                                             |
| TIME-07                | PASS for covered transitions          | Auto-refetch verifier and recovery tests pass                                                                                                                 |
| PERSIST-01             | PASS at category/declaration level    | Updated policy permits declared categories; protected lookups are explicitly non-persistent                                                                   |
| PERSIST-02             | PASS for tested integration           | Official persister integration and query-state regressions pass                                                                                               |
| PERSIST-04             | PASS for unit/component evidence only | Earlier recursive updates and hydration expectation fixed; production-browser evidence deferred                                                               |
| PERSIST-05             | PASS for tested integration           | Query admission and copied-mail-state purge regressions pass; production-browser evidence remains deferred                                                    |
| PERSIST-06, PERSIST-07 | PASS for tested paths                 | Session-response race and copied-mail invalidation regressions pass                                                                                           |
| ESI-07                 | PASS for prior frontend finding only  | Invalid-response retry correction verified; combined browser/server retry budgets remain Layer 2                                                              |

## Verification

Local logs are under `/var/folders/y0/8p43tkrn7rz1f8jlttdq2c900000gn/T/opencode/`. Package builds completed sequentially before dependent tests. Commands use the repository's Corepack-managed pnpm.

| Command                                                                                                                                                                                                                         | Result                    | Log basename                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------- |
| `pnpm --filter @eve-space/platform-module-contract build`                                                                                                                                                                       | Passed                    | `fetching-layer1-final-contract-build.log`     |
| `pnpm --filter @eve-space/platform-module-nuxt build`                                                                                                                                                                           | Passed                    | `fetching-layer1-final-nuxt-package-build.log` |
| `pnpm exec tsx scripts/verify-query-persistence-boundaries.ts`                                                                                                                                                                  | Passed                    | `fetching-layer1-final-boundaries.log`         |
| `pnpm exec tsx scripts/verify-esi-query-persistence.ts`                                                                                                                                                                         | Passed                    | `fetching-layer1-final-boundaries.log`         |
| `pnpm exec vitest run --config vitest.config.ts tests/queries tests/auth tests/mail tests/organization tests/record-navigation tests/assets/character-assets-query.test.ts tests/platform/query-persistence-boundaries.test.ts` | **501 passed / 44 files** | `fetching-layer1-final-unit.log`               |
| `pnpm exec vitest run --config vitest.ui.config.ts tests/ui/dashboard-shell.nuxt.test.ts tests/ui/esi-resource-boundary.nuxt.test.ts tests/ui/app-platform-identity.nuxt.test.ts tests/ui/app-upstream-notice.nuxt.test.ts`     | **19 passed / 4 files**   | `fetching-layer1-final-ui.log`                 |
| `pnpm --filter @eve-space/platform-module-nuxt exec vitest run test/runtime.test.ts test/runtime-composables.test.ts test/query-persistence-presentation.test.ts`                                                               | **18 passed / 3 files**   | `fetching-layer1-final-platform.log`           |

## Next checkpoint

1. Review accumulated HR audit state and complete the private-presentation/context-switch journeys, including real browser hydration and cross-tab invalidation, before expanding this scoped conclusion to full Layer 1 sign-off.
2. Continue with server resource freshness/caching and ESI execution as Layer 2; their correctness is not inferred from these frontend results.
