# Fetching compliance recheck: Layer 1 — frontend queries

## Conclusion

**Layer 1 remains non-compliant because copied mail headers survive private-cache purging.** The four findings from the [initial review](fetching-layer-review-frontend.md) are resolved in the tested scope, and the updated persistence policy resolves the original allowlist conflict.

Existing focused frontend tests now pass: **403 tests across 42 files**, plus **17 UI tests across 4 files**. The selected platform suites have **16 passing tests and one failing test whose mock does not implement the declared reader contract**. A separate diagnostic reproduces the mail defect; another confirms that a correctly implemented reactive reader works.

## Scope and policy

- Date: 2026-09-15; base commit remains `a254cbd7990e3df43574035c0c28118d13636b3c`.
- Reviewed the current uncommitted working tree after the user confirmed that the persistence refactor could be rechecked. It includes the extracted `private-lifecycle.ts`, entry-state changes, live-session lookup gates, retry correction, and regression tests.
- Governing rules: root `AGENTS.md`, `app/query-persistence/AGENTS.md`, the platform Nuxt scoped guide, and the [fetching checklist](fetching-layer-compliance-checklist.md).
- Public, character, and organization ESI persistence are now permitted when explicitly classified. Public persistence still requires a genuinely public application route. Private persistence remains owner/admission-bound; session and authorization decisions remain excluded.
- This recheck covers the prior findings, their affected query consumers, the refactored persistence integration, and the previously blocked mail-copy purge scenario. It is not a full server-cache, installed-module, or production-browser audit.
- Application code and existing tests were not corrected during this audit. Diagnostic probe source is retained outside the repository.

## Request inventory updates

The initial inventory remains the request-discovery reference. These rows replace its outdated lookup/persistence classifications; final API access requirements were rechecked at `api/src/index.ts:59–68`.

| Request / interface          | Current identity and trigger                                                                                    | Final route / access                                                         | Current persistence                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| Character record lookup      | `PRIVATE_QUERY_KEYS.characterRecord(id)`; client, verified session, valid ID; data presentation also gated      | `GET /api/characters/:characterId`; application session                      | None                                            |
| Corporation record lookup    | `PRIVATE_QUERY_KEYS.corporationRecord(id)`; client, verified session, valid ID; data presentation also gated    | `GET /api/corporations/:corporationId`; application session                  | None                                            |
| Corporation alliance history | Private corporation/history key; inherited record-access gate and player-corporation selection                  | `GET /api/corporations/:corporationId/alliance-history`; application session | None                                            |
| Organization activities      | Existing organization key; client authentication/compliance gate                                                | `GET /api/organization/activities`; organization activity access             | Organization ESI; category now policy-approved  |
| Organization roster coverage | Existing organization key; client member/HR capability gate                                                     | `GET /api/organization/roster-coverage`; organization HR                     | Organization ESI; category now policy-approved  |
| Session verification         | Request-start generation plus cancellation/supersession checks                                                  | `GET /auth/session`; cookie-dependent identity                               | None                                            |
| Logout                       | Advances verification generation and cancels session work before/after logout completion                        | `POST /auth/logout`; deletes server session and cookie                       | None                                            |
| Mail headers                 | Character ID, normalized labels, cursor; client auth/ownership gate; response copied into local `loadedHeaders` | `GET /api/me/characters/:characterId/mail`; owned character                  | Character ESI; local-copy purge defect F5 below |

The lookup query declarations are at `app/queries/characters.ts:52` and `app/queries/corporations.ts:21–54`. Their live-session execution and presentation gates are in `app/pages/character/[characterId].vue:13–22`, `app/pages/corporation/[corporationId].vue:14–23`, and its `alliance-history.vue:10–33`.

## Previously reported findings

| Finding                                    | Current result                                       | Implementation and verification evidence                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1: recursive shared-query updates         | Resolved in tested scope                             | `app/query-persistence/runtime.ts:744–784` filters eligibility and only publishes actual state changes. Shared-query, clone, mail-badge, and DashboardShell cases now pass.                                                                                                                                                                                               |
| F2: old session response reverses logout   | Resolved for the reproduced race                     | `useAuthSession.ts:26` captures generation before fetching; `useAuthVerification.ts:44–46` checks supersession; logout at `useAuthSession.ts:92–117` advances generation and cancels session work. `tests/queries/private-query-lifecycle.test.ts:192` verifies a pre-logout response cannot restore identity. Route middleware also captures a request-start generation. |
| F3: protected lookup persisted as public   | Resolved for current query definitions and consumers | Lookups use private non-persisted keys and live-session execution/presentation gates. API root mounts still require a session. Classification, SSR/auth, and record-navigation checks pass.                                                                                                                                                                               |
| F4: invalid-response retry                 | Resolved for `ESI_RESPONSE_INVALID`                  | `app/utils/colada-options.ts:13–15` rejects the stable error code before the 5xx fallback; the corresponding retry regression at `tests/queries/query-infrastructure.test.ts:131` passes.                                                                                                                                                                                 |
| Character-only persistence policy conflict | Resolved                                             | `AGENTS.md:211–213` now explicitly permits public, character, and organization ESI categories with their respective restrictions.                                                                                                                                                                                                                                         |
| Expired-during-hydration expectation       | Resolved                                             | The test now expects no data and no retained access after the tuple expires. `tests/queries/query-persistence-runtime.test.ts:126` passes.                                                                                                                                                                                                                                |
| Mid-refactor `now is not a function` error | No longer reproduced                                 | `initializeQueryCacheHooks` now consistently takes `(state, privateLifecycle, now)` at `runtime.ts:678`. The probe reaches its intended assertion; the existing frontend suites pass.                                                                                                                                                                                     |

## F5 — High: copied mail headers remain visible after private-cache purging

- Checks: **AUTH-06**, **QUERY-03**, **PERSIST-06**, **PERSIST-07**.
- Governing rule: invalidation must remove affected private in-memory data and close its presentation. A cleared query cache alone is insufficient when consumers keep private copies.
- Source: `app/composables/useCharacterMailbox.ts:48` stores `loadedHeaders`. The watcher at lines 282–294 copies successful query data but returns immediately when the query becomes empty. The reset at line 280 only watches character ID, so invalidation with the same selected character leaves the copy intact. `displayedHeaders` at lines 108–121 continues to expose it.
- Consumer: `app/pages/characters/[characterId]/mail.vue:192–228` passes these headers to `MailHeaderList`. After an error-free purge, `deriveMailboxStatus` can return `idle` with no initial data (`app/utils/mail-view.ts:243–269`), so the resource boundary does not hide the copied list. The parent character shell can stay mounted when retained-cache admission is invalidated without a session/roster change.
- Mounted access: `api/src/index.ts:64` mounts `mailRoutes` at `/api/me/characters`; `api/src/mail/routes.ts:127–133` applies session loading and owned-character middleware before reading mail. The browser copy contains protected character data.
- Reproduction: mount the real mailbox composable with the application query plugins, populate the mail-header query, confirm its subject renders, call `invalidatePrivateQueryScope(queryCache, { kind: 'character', characterId: 7 })`, then await reactive updates.
- Observed: `queryCache.getQueryData(key)` is `undefined`, but the rendered subject remains `Retained private subject`. The probe reaches both assertions without the earlier recursive-update or refactor errors.
- Expected: affected copied headers, selected message, and pagination state are cleared or made unavailable when private cache access is invalidated. A new successful request may populate them again.
- Proposed correction: make mailbox-local state participate in the same invalidation lifecycle. Reset the copy and pagination/selection on authoritative cache purging and gate its presentation appropriately. Preserve intentional retention during ordinary background refreshes that remain authorized.
- Verification limit: this is a mounted-composable reproduction plus a page-source trace, not a production-browser journey. The defect is not a claim that the server permits unauthorized new mail requests.

## Remaining platform test-fixture mismatch

`packages/platform-module-nuxt/test/query-persistence-presentation.test.ts:21–22` provides a reader taking a resolved `EntryKey`. The declared `PlatformQueryPersistenceReader` takes a `MaybeRefOrGetter<EntryKey>` and returns a reactive presentation reference (`src/runtime/query-persistence-presentation.ts:36–52`). The test passes a ref, then changes its value, but its mock neither unwraps that ref nor derives a reactive result. Consequently it renders `fresh` instead of `restored`.

The production host in `app/app.vue:12` forwards the reactive key to `readQueryPersistenceState`, which calls `toValue(key)` inside a computed at `app/query-persistence/runtime.ts:358–371`. A diagnostic using the declared reader type and the same reactive-key transition passes.

Treat this as a **test-fixture defect**, not established evidence that the production injection interface is broken. Update the mock to honor the current contract and assert the reactive key/result behavior. The platform suite remains failing until that correction is made.

## Current checklist results

Results are limited to the evidence below. Unlisted server-layer checks and untested browser journeys remain deferred.

| Checks                 | Result                                | Evidence / limitation                                                                                                                                         |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-01, MOD-05         | PASS                                  | Typed application-query interface preserved; scoped persistence import checks and shared-consumer regressions pass                                            |
| AUTH-01, AUTH-02       | PASS for inspected paths              | Mounted route classification and client/SSR gates now agree; focused auth and lookup checks pass                                                              |
| AUTH-03                | PASS for tested paths                 | Protected intent-prefetch and existing recovery tests pass; exhaustive background-event combinations deferred                                                 |
| AUTH-06, QUERY-03      | FAIL                                  | F5: invalidation leaves a rendered private copy                                                                                                               |
| QUERY-01, QUERY-02     | BLOCKED for complete sign-off         | Principal identities and ordinary owner changes tested; complete organization-version, local-copy, and context-switch audit remains broader than these checks |
| QUERY-04, QUERY-05     | PASS for inspected contracts          | `AppType` inference and existing mounted-route structure preserved                                                                                            |
| QUERY-06               | BLOCKED                               | Full mail/organization mutation and authorization-change lifecycle still needs review                                                                         |
| TIME-03                | PASS for covered persistence cases    | Retention, local-write, original-time, and expired-hydration tests pass                                                                                       |
| TIME-04                | BLOCKED for complete sign-off         | Shared UI tests pass; the package fixture must be corrected; F5 is an outstanding presentation issue                                                          |
| TIME-07                | PASS for covered transitions          | Auto-refetch verifier and recovery tests pass                                                                                                                 |
| PERSIST-01             | PASS at category/declaration level    | Updated policy permits declared categories; protected lookups are explicitly non-persistent                                                                   |
| PERSIST-02             | PASS for tested integration           | Official persister integration and query-state regressions pass                                                                                               |
| PERSIST-04             | PASS for unit/component evidence only | Earlier recursive updates and hydration expectation fixed; production-browser evidence deferred                                                               |
| PERSIST-05             | BLOCKED for end-to-end sign-off       | Query-level admission tests pass, but F5 shows consumer-held data can outlive cache admission/purging                                                         |
| PERSIST-06, PERSIST-07 | FAIL end-to-end                       | Session-response race fixed; copied mail state still survives invalidation                                                                                    |
| ESI-07                 | PASS for prior frontend finding only  | Invalid-response retry correction verified; combined browser/server retry budgets remain Layer 2                                                              |

## Verification

Local logs are under `/var/folders/y0/8p43tkrn7rz1f8jlttdq2c900000gn/T/opencode/`. Package builds completed sequentially before dependent tests. Each command below used the `corepack` prefix.

| Command                                                                                                                                                                                                                         | Result                                     | Log basename                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| `pnpm --filter @eve-space/platform-module-contract build`                                                                                                                                                                       | Passed                                     | `fetching-layer1-resumed-contract-build.log`     |
| `pnpm --filter @eve-space/platform-module-nuxt build`                                                                                                                                                                           | Passed                                     | `fetching-layer1-resumed-nuxt-package-build.log` |
| `pnpm exec tsx scripts/verify-query-persistence-boundaries.ts`                                                                                                                                                                  | Passed                                     | `fetching-layer1-resumed-boundaries.log`         |
| `pnpm exec tsx scripts/verify-esi-query-persistence.ts`                                                                                                                                                                         | Passed                                     | `fetching-layer1-resumed-boundaries.log`         |
| `pnpm exec vitest run --config vitest.config.ts tests/queries tests/auth tests/mail tests/organization tests/record-navigation tests/assets/character-assets-query.test.ts tests/platform/query-persistence-boundaries.test.ts` | **403 passed / 42 files**                  | `fetching-layer1-resumed-unit.log`               |
| `pnpm exec vitest run --config vitest.ui.config.ts tests/ui/dashboard-shell.nuxt.test.ts tests/ui/esi-resource-boundary.nuxt.test.ts tests/ui/app-platform-identity.nuxt.test.ts tests/ui/app-upstream-notice.nuxt.test.ts`     | **17 passed / 4 files**                    | `fetching-layer1-resumed-ui.log`                 |
| `pnpm --filter @eve-space/platform-module-nuxt exec vitest run test/runtime.test.ts test/runtime-composables.test.ts test/query-persistence-presentation.test.ts`                                                               | **16 passed / 1 failed**                   | `fetching-layer1-resumed-platform.log`           |
| `pnpm exec vitest run --config vitest.config.ts tests/queries/fetching-layer1-recheck.probe.test.ts`                                                                                                                            | Mail-purge assertion failed, confirming F5 | `fetching-layer1-resumed-probes.log`             |
| `pnpm exec vitest run --config vitest.config.ts tests/queries/fetching-layer1-recheck.probe.test.ts -t "reactive reader"`                                                                                                       | **1 passed / 1 unselected**                | `fetching-layer1-resumed-reader-probe.log`       |

The diagnostic source is retained as `fetching-layer1-recheck.probe.test.ts` in the log directory, outside the repository test suite. Its relative imports assume the original `tests/queries/` location. The later reader diagnostic was added after the mail-only run; the two logs intentionally cover different assertions.

## Next checkpoint

1. Correct F5 and add a regression that checks both cache removal and rendered/copied mail state.
2. Correct the platform reader test fixture and rerun its owning suite.
3. Review accumulated HR audit state and complete the private-presentation/context-switch journeys, including real browser hydration and cross-tab invalidation, before giving Layer 1 a full sign-off.
4. Continue with server resource freshness/caching and ESI execution as Layer 2; their correctness is not inferred from these frontend results.
