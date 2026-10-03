# Market selected-item GraphQL fetching review

## Scope

- Change: `pilot-market-item-graphql-ui`.
- Baseline commit: `52135c6f29f5e11640e2412938670cbc47c4d299`.
- Baseline source commit is unchanged. Pre-existing edits to AGENTS.md, CLAUDE.md, and this report were present at session start. Selected-item transport was unchanged during measurement.
- Governing requirements: root `AGENTS.md`, `docs/fetching-layer-compliance-checklist.md`, and this change's proposal, design, specs, and tasks.
- Status: groups 1–6 complete the local consumer implementation and controlled verification. The full group 7 shared-contract matrix, deployment probes and release/rollback review remain pending. Historical per-group evidence is retained below.

## Pre-change REST request inventory

Paths below are relative to `/api/modules/market`. Query clocks are the explicit pre-change `staleTime` values; they do not establish upstream freshness, residency, or persistence eligibility.

| Resource                | Baseline request                                                                  | Consumer                     | Selectors / activation                                      | Query freshness                                 |
| ----------------------- | --------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| Catalogue discovery     | GET `/catalogue/revision`, then GET `/catalogue/body/:revision/tree`              | `MarketPage.vue`             | Current revision; browse tree                               | 30 seconds                                      |
| Selected item           | GET `/catalogue/body/:revision/types/:typeId`                                     | `useMarketOverview.ts`       | Catalogue revision and selected type                        | Revision-immutable                              |
| Enabled public profiles | GET `/books/profiles`                                                             | `useMarketOverview.ts`       | Shared profile discovery                                    | 30 seconds                                      |
| Book and initial sides  | GET `/books/profiles/:profileId/types/:typeId/observation`                        | `useMarketOverview.ts`       | Profile ID/revision and type; active order-book tab         | 10 seconds                                      |
| Order continuation      | GET `/books/profiles/:profileId/types/:typeId/observations/:observationId/orders` | `MarketOrderTable.vue`       | Observation, side, price/time/order tuple; scroll traversal | Imperative request; no independent Colada entry |
| Daily history           | GET `/history/profiles/:profileId/types/:typeId`                                  | `useMarketOverview.ts`       | Profile ID/revision and type; active history tab            | 60 seconds                                      |
| History demand          | POST `/history-intent/profiles/:profileId/types/:typeId/demand`                   | `useMarketHistoryRequest.ts` | Mounted client demand and bounded polling                   | Separate command workflow                       |

The pilot retains catalogue browse/search/Quickbar interfaces and the history-demand command. `MarketPage.vue` currently stages server prefetch through catalogue discovery, selected item/profiles, and the active book or history resource. `useMarketOverview.ts` checks captured selectors before presentation; order continuation currently reconstructs tuple selectors from rows.

The intended GraphQL counterparts already appear in `features/market/server/src/graphql.ts`: `MarketRead.catalogueType`, `profiles`, `book`, `orders`, and `history`. The final endpoint mounts in `api/src/index.ts` through `graphqlRoutes`, before character-route session middleware. The endpoint has global CSRF/CORS protection and per-read admission in its execution layer. Route mount order alone does not prove public field admission. The completed field/admission contract and final consumer inventory appear below.

## Baseline measurements

The executed pre-change measurements below use the existing controlled fixture in `tests/support/market-browser-fixture.mjs`. Regional profile `00000000-0000-4000-8000-000000000001` supplies Rifter (`587`) and the 103-order paging item (`40520`); Global PLEX profile `00000000-0000-4000-8000-000000000004` supplies PLEX (`44992`). The same fixture rows must be used for the post-change comparison.

## Results

| Check                              | Result  | Implementation evidence                                                           | Test or probe evidence                                                                               |
| ---------------------------------- | ------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Task 1.1 pre-change baseline       | PASS    | REST request inventory above                                                      | Executed production fixture measurements and raw request records below                               |
| Task 1.2 field/admission inventory | PASS    | Selected document fields, mounted endpoint and public contribution strategy below | Offline schema validation and actual execution-policy probe; all six operations fit unchanged limits |
| Local consumer migration           | PASS    | Groups 2–6 implementation and inventory below                                     | Owning transport/query suites, nine production-browser journeys and before/after probe below         |
| Full matrix and deployment         | BLOCKED | Group 7 remains outside the current requested group                               | Review shared checks recorded below; full group 7 runners/probes remain pending                      |

## Policy conflicts and missing evidence

The prior local socket restriction is resolved. Baseline production fixture probes are complete; they do not establish deployment behavior. The older smoke script expects a daily table, while the current source renders a keyboard-accessible canvas; baseline readiness was measured against that actual canvas. Fixture history-demand POSTs returned 404 and are retained in raw request evidence, separate from read counts.

Groups 1–6 and the six requested review corrections are complete locally. The review reproduced a misleading unavailable-source warning for an uncollected SSR book, which the first group 6 assertions missed. The corrected production assertion now passes. Repository-wide lint and whole-Market runtime compilation pass with unchanged quality baselines. The review section below supersedes the initial quality/typecheck results and records the executed shared-client checks. Group 7's remaining full integration/release work and matching live runtime probes remain pending. No deployment or archive was performed.

## Prior-session blocked attempts

| Exact command                                   | Exit status / result                                                              | Log path                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `node --version`                                | 0; `v24.20.0`                                                                     | Tool output                                                             |
| `docker compose ps`                             | 0; API, worker, PostgreSQL, queue Redis, and cache Redis healthy                  | Tool output; this is existing-stack health, not deployment verification |
| `corepack pnpm build`                           | 1; `tsx` failed creating an IPC socket with `listen EPERM`                        | `/tmp/eve-market-graphql-logs/baseline-build.log`                       |
| `node tests/support/market-browser-fixture.mjs` | 1; HTTP listener failed with `listen EPERM: operation not permitted 0.0.0.0:9876` | `/tmp/eve-market-graphql-logs/fixture.log`                              |

## Conclusion

The selected-item consumer is implemented and verified within the controlled source/fixture scope described below. Baseline and production-fixture evidence do not establish target-deployment behavior. Group 7 remains required before release.

## Executed pre-change baseline (2026-10-02)

Production `pnpm build` exited 0. The existing fixture ran on port 9876, with a transparent measurement proxy on 9877 and production Nuxt on 3002 (`NUXT_PUBLIC_API_BASE=http://localhost:9877`). Each phase resets proxy counters; measurements include SSR and browser API calls. Byte counts are compressed response body bytes, exclude headers, and include the fixture’s compression. Times are a single local sample, not performance thresholds. Fixture rows and source timestamps are unchanged. The warm journey selects PLEX then returns to Rifter.

| Phase                              | Market GET reads | Response bytes | Summed API latency ms | Header ms | Visible rows/chart ms | Browser selected reads |
| ---------------------------------- | ---------------: | -------------: | --------------------: | --------: | --------------------: | ---------------------: |
| cold regional SSR and hydration    |                5 |           1152 |                  2.54 |    159.94 |                173.22 |                      0 |
| history activation                 |                1 |            490 |                  2.55 |     45.77 |                 53.83 |                      1 |
| warm selection return              |                3 |         101791 |                 17.25 |    180.38 |                181.56 |                      3 |
| cold Global PLEX SSR and hydration |                5 |           1146 |                  3.04 |    155.51 |                170.55 |                      0 |
| history deep link                  |                5 |           1185 |                  3.08 |     90.85 |                 96.64 |                      0 |
| order continuation forward         |                1 |            319 |                  1.43 |     52.10 |                 54.17 |                      1 |
| order continuation return          |                0 |              0 |                  0.00 |     22.19 |                 25.68 |                      0 |

Raw per-request evidence and reproducible probe: `/tmp/eve-market-graphql-logs/rest-baseline.json`, `baseline.mjs`, and `measure-proxy.mjs`. Build/listener logs are in the same directory. Hydration produced zero selected read duplicates for both item links and the history deep link; shell auth/status calls are excluded from Market counts. The retained client-only history-demand POST returned fixture 404 during history activation/deep link; it is recorded in raw evidence and excluded from read counts. The current history presentation exposes a keyboard-accessible canvas, rather than the daily table expected by the older smoke script. Forward paging reached rows 101–103 and return reached 1–100.

## Proposed operation contract

`market-operations.graphql` selects catalogue revision/item IDs/name; complete public profiles (including mode/stations/watched types); book selector/status/replacement/observation; both order aliases or one continuation with all displayed row fields, labels completeness and nextCursor; history selector/status/freshness/source clocks and six daily fields. There is no reference-price selection. Exact decimal values and IDs/counts are GraphQL strings; conversion remains a presentation boundary.

Admission: `api/src/index.ts:68` mounts `graphqlRoutes` behind global CSRF/CORS. `api/src/graphql/request-execution.ts:79` passes no session for public contributions, while installed enablement and granted capabilities remain checked. Every selected read/projection is declared public in `features/market/manifest/manifest.json`. Book/orders/history use existing storage readers; no read has history-demand or ESI collection grants. Catalogue revision remains the existing REST discovery, profile revision participates in client identities, order observation and cursor are explicit server selectors. `observedAt`, `validatedAt`, and `freshUntil` retain separate source clocks.

Offline probe against the composed application SDL and manifest-derived actual field policies: `corepack pnpm exec tsx /tmp/eve-market-graphql-logs/budget.mts` exited 0; evidence `operation-budget.log`. MarketItem: cost 8 / rows 0; MarketProfiles: 490 / 468; MarketBook: 23 / 0; MarketInitialOrders: 3039 / 400; MarketOrderContinuation: 1520 / 200; MarketHistory: 2930 / 365. All verdicts are public and use unchanged cost/row limits. The row budget counts list selections conservatively, independently of actual fixture row counts.

## Checks completed before the requested stop

| Command                                                                                                                                                                                   | Result                                        | Log path                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `corepack pnpm build` (pre-change)                                                                                                                                                        | PASS                                          | `/tmp/eve-market-graphql-logs/baseline-build.log`      |
| `corepack pnpm --filter @eve-space/platform-module-nuxt build`                                                                                                                            | PASS                                          | `/tmp/eve-market-graphql-logs/platform-build.log`      |
| `corepack pnpm exec nuxt typecheck` (intermediate implementation)                                                                                                                         | PASS                                          | `/tmp/eve-market-graphql-logs/iteration-typecheck.log` |
| `corepack pnpm --filter @eve-space/platform-module-nuxt exec vitest run test/graphql-transport.test.ts`                                                                                   | PASS, 4 tests                                 | `/tmp/eve-market-graphql-logs/transport-test.log`      |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/graphql/client.test.ts`                                                                                                    | PASS, 17 tests                                | `/tmp/eve-market-graphql-logs/root-client-test.log`    |
| `corepack pnpm exec vitest run --config vitest.ui.config.ts features/market/nuxt/test/market-history-ready.nuxt.test.ts features/market/nuxt/test/market-overview-interface.nuxt.test.ts` | PASS, 7 tests                                 | `/tmp/eve-market-graphql-logs/market-mounted-test.log` |
| `corepack pnpm graphql:check`                                                                                                                                                             | PASS, including strict Market compile fixture | `/tmp/eve-market-graphql-logs/graphql-check.log`       |
| `corepack pnpm --filter @eve-space/market-nuxt test`                                                                                                                                      | PASS, 32 tests                                | `/tmp/eve-market-graphql-logs/market-unit.log`         |

These intermediate checks do not replace final validation. Later edits, production GraphQL browser journeys, packaged feature isolation, formatting/lint, full integration runners and deployment still need verification when implementation resumes.

## Group 2 completion (2026-10-02)

Tasks 2.1–2.3 are complete. The schema-independent platform runtime owns typed documents, JSON variables/envelopes, deterministic variable normalization, safe field errors, and JSON POST execution. The configured `usePlatformGraphQL()` auto-import captures the API origin without startup I/O. Root callers consume the same runtime while retaining private admission, result-release/presentation gates, authorization-denial reporting, and exact-character cleanup. The transport enforces caller cancellation and its 16-second deadline through body consumption, including late responses that ignore cancellation.

`docs/graphql-application-api.md` records the public SSR and protected client-only contract. Platform fixtures cover configured execution and no request during setup/hydration. The isolated installed-tarball consumer compiles typed documents and rejects invalid variables/result selections without host schema source; it also executes the packaged transport. Boundary fixtures accept the approved runtime and reject root GraphQL, API schema, and feature-server imports.

| Check                                                                                                                                | Result                                                                          | Log path                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `corepack pnpm --filter @eve-space/platform-module-nuxt build`                                                                       | PASS                                                                            | `/tmp/eve-market-graphql-logs/group2-platform-build.log`        |
| `corepack pnpm --filter @eve-space/platform-module-nuxt typecheck`                                                                   | PASS, runtime and isolated Nuxt fixture                                         | `/tmp/eve-market-graphql-logs/group2-platform-typecheck.log`    |
| `corepack pnpm --filter @eve-space/platform-module-conformance typecheck`                                                            | PASS                                                                            | `/tmp/eve-market-graphql-logs/group2-conformance-typecheck.log` |
| `corepack pnpm test:platform-public-packages`                                                                                        | PASS, isolated tarball compile/runtime and installed conformance                | `/tmp/eve-market-graphql-logs/group2-public-packages.log`       |
| `corepack pnpm --filter @eve-space/platform-module-nuxt test`                                                                        | PASS, 102 tests including 7 transport tests and registered Nuxt/browser fixture | `/tmp/eve-market-graphql-logs/group2-platform-tests.log`        |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/graphql/client.test.ts tests/queries/private-query-lifecycle.test.ts` | PASS, 41 tests                                                                  | `/tmp/eve-market-graphql-logs/group2-private-regressions.log`   |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/queries/request-signal.test.ts`                                       | PASS, 2 tests                                                                   | `/tmp/eve-market-graphql-logs/group2-request-signal.log`        |
| `corepack pnpm exec vitest run --config vitest.registry.config.ts tests/platform/module-package-boundaries.test.ts`                  | PASS, 164 tests                                                                 | `/tmp/eve-market-graphql-logs/group2-feature-boundaries.log`    |
| `corepack pnpm exec nuxt typecheck`                                                                                                  | PASS, root callers                                                              | `/tmp/eve-market-graphql-logs/group2-root-typecheck.log`        |
| Scoped `oxlint` on group 2 source/tests                                                                                              | PASS                                                                            | `/tmp/eve-market-graphql-logs/group2-lint.log`                  |
| Scoped `oxfmt --check` on group 2 files                                                                                              | PASS                                                                            | `/tmp/eve-market-graphql-logs/group2-format.log`                |
| Scoped `platformNuxtBoundaryViolations(await loadPlatformNuxtSources(process.cwd()))`                                                | PASS                                                                            | `/tmp/eve-market-graphql-logs/group2-platform-boundaries.log`   |
| `corepack pnpm exec tsx scripts/verify-graphql-boundaries.ts`                                                                        | PASS                                                                            | `/tmp/eve-market-graphql-logs/group2-graphql-boundaries.log`    |

The repository-wide `verify-nuxt-module-boundaries.ts` check fails on `features/market/nuxt/src/runtime/app/market-models.ts` importing host-only `PlatformApiClient` (`group2-nuxt-boundaries.log`). That file belongs to the unfinished later-group edits and was left unchanged under the requested scope. This group’s passing package and boundary fixtures do not establish whole-migration readiness. The full group 7 matrix, feature migration, production browser comparison, and deployment remain pending.

## Group 3 completion (2026-10-02)

Tasks 3.1–3.3 are complete. The six Market-owned operations generate self-contained selected types, referenced enums, typed strings, and schema/document SHA-256 identities in `features/market/nuxt/src/runtime/app/market-graphql.ts`. Root and feature generation share the same strict scalar mapping. The generated consumer imports only the platform `GraphQLDocument` type; it contains no copied application schema or runtime GraphQL dependency.

The feature owns `test/types/graphql.ts` and `tsconfig.graphql.json`. Normal Market build/typecheck and root `graphql:types` include this independent contract check, which rejects numeric scalar inputs/results, missing cursors, invalid sides, and unselected fields. Existing root example generation/typechecking remains supported. The root build/lint drift gate checks the Market artifact, and an executed temporary drift probe proved that an altered artifact is rejected and then restored.

`test:modules` now invokes `test:graphql:packages`, preserving the public SDK checks while additionally packing the real Market package. The isolated copied-tarball consumer compiles the feature fixture against the installed artifact without host-source aliases or workspace links. It then compiles and executes the installed generated document through the installed transport. The packaged document source must be present and its hash must match the generated identity. Native Node cannot strip TypeScript under `node_modules`, so the verifier compiles installed source before executing it, preserving the Nuxt runtime packaging strategy. Extension/regeneration commands are documented in `docs/graphql-application-api.md`.

| Check                                                                                                               | Result                                                                                                                     | Log path                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `corepack pnpm exec tsx scripts/generate-graphql.ts --write`                                                        | PASS, offline root and Market generation from existing installed SDL                                                       | `/tmp/eve-market-graphql-logs/group3-generate-artifacts.log`                                     |
| `corepack pnpm graphql:check`                                                                                       | PASS, drift and root/feature strict type fixtures                                                                          | `/tmp/eve-market-graphql-logs/group3-graphql-check.log`                                          |
| Temporary altered Market artifact followed by actual generator `--check`                                            | PASS, expected drift rejection; original artifact restored                                                                 | `/tmp/eve-market-graphql-logs/group3-drift-probe.log`                                            |
| `corepack pnpm test:graphql:packages`                                                                               | PASS, drift, dependency/Market builds, isolated tarball compile/runtime, document hash and installed SDK conformance       | `/tmp/eve-market-graphql-logs/group3-packages.log`                                               |
| `corepack pnpm --filter @eve-space/market-nuxt typecheck`                                                           | PASS, module and feature-owned contract fixture                                                                            | `/tmp/eve-market-graphql-logs/group3-market-typecheck.log`                                       |
| `corepack pnpm --filter @eve-space/platform-module-nuxt typecheck`                                                  | PASS, independent runtime/Nuxt fixture                                                                                     | `/tmp/eve-market-graphql-logs/group3-platform-typecheck.log`                                     |
| `corepack pnpm --filter @eve-space/platform-module-conformance typecheck`                                           | PASS, including package-verifier scripts                                                                                   | `/tmp/eve-market-graphql-logs/group3-conformance-typecheck.log`                                  |
| `corepack pnpm exec vitest run --config vitest.config.ts tests/graphql/generation.test.ts`                          | PASS, 3 tests: determinism, schema/document drift, invalid selections, unnamed queries and unknown scalars                 | `/tmp/eve-market-graphql-logs/group3-generation-tests.log`                                       |
| `corepack pnpm --filter @eve-space/api exec vitest run tests/graphql-schema-artifact.test.ts`                       | PASS, 11 tests including all six Market documents against the actual composed schema and unchanged public execution policy | `/tmp/eve-market-graphql-logs/group3-operation-policy-tests.log`                                 |
| `corepack pnpm --filter @eve-space/market-nuxt test`                                                                | PASS, 32 tests                                                                                                             | `/tmp/eve-market-graphql-logs/group3-market-tests.log`                                           |
| `corepack pnpm exec vitest run --config vitest.registry.config.ts tests/platform/module-package-boundaries.test.ts` | PASS, 164 tests                                                                                                            | `/tmp/eve-market-graphql-logs/group3-boundary-tests.log`                                         |
| Scoped `oxlint` and `oxfmt --check` on group 3 files                                                                | PASS                                                                                                                       | `/tmp/eve-market-graphql-logs/group3-lint.log`, `/tmp/eve-market-graphql-logs/group3-format.log` |

`corepack pnpm graphql:generate` remains blocked in its preceding registry generation by the previously recorded later-group `market-models.ts` import of host-only `PlatformApiClient` (`group3-generate.log`). The GraphQL generator itself and checked artifacts pass using the existing installed SDL; the registry gate was preserved. These contract checks do not establish conformance or full runtime readiness for the unfinished Market presentation changes. Groups 4–7, the full matrix, production comparison and deployment remain pending.

## Group 4 completion (2026-10-02)

Tasks 4.1–4.4 cover selected-item adapters, catalogue/profile/book/history Colada reads, cache
classification and localized presentation. Operation keys include both generated identities and
all catalogue/profile/type selectors; returned selectors and cancellation are checked before
release and presentation. Same-selection refresh failures keep original successful data and source
clocks. Catalogue types explicitly missing from the pinned catalogue remain distinct from host,
rejected-operation and executed-field errors. Path projection covers ancestor and descendant errors
without invalidating a successful sibling. No-data/pathless rejections retain a request-failure
classification even when error extensions omit a status. The owning mounted regression first
failed with status 502 instead of 400 (`group4-rejection-regression-control.log`) and passes after
the adapter correction.

Adapters retain exact price strings, observation/source timestamps and opaque continuation values.
Number-backed identifiers/counts require canonical safe integers; bigint checks totals before
arithmetic. Unsupported order-price precision and unsupported history values fail intentionally
instead of rounding or silently omitting data. Presentation types are inferred from these adapters
and generated selections, removing the host-only API client import without a parallel GraphQL
schema or copied response contract. The previously blocked Nuxt boundary and top-level
`graphql:generate` commands now pass.

Catalogue/profile/book/history freshness remains revision-immutable / 30 seconds / at most
10 seconds / at most 60 seconds. Source expiry shortens book/history reuse. Detached entries have
five-minute residency, zero retries and explicit `esiPersistence: { kind: 'none' }`.
The narrow platform `defineNonPersistentQueryOptions()` factory enforces that opt-out at type and
runtime boundaries; feature code cannot declare a persistence grant through it. The original
verifier prohibition on feature use of the general classification factory remains enforced. Book/history
activation remains tab-specific. The persistence proof executes a real generated request into a
successful Colada entry with the installed persister, keeps in-memory reuse, and confirms an
eligible positive-control query is durably written while the Market entry is excluded.

The feature contract describes the model/error distinctions. Mounted tests retain direct links,
PLEX/regional eligibility, Browse/Quickbar behavior, sorting and chart/table presentation; partial
side rendering leaves the successful side usable and the other side/summary unknown. Controlled
pre-fix checks restored the old nested-path predicate and removed the price guard: both intended
regressions failed before the final adapters were restored (`group4-regression-control.log`).

Final verification evidence: This is source/fixture evidence;
observation-pinned traversal, SSR/hydration production journeys, history-demand integration,
measurements, deployment and the complete group 7 matrix remain to be finished in groups 5–7.

| Check                                                                                                               | Result                                                                                                              | Log path                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `corepack pnpm graphql:generate`                                                                                    | PASS, including registry prerequisites formerly blocked by the host-only model import                               | `/tmp/eve-market-graphql-logs/group4-generate.log`                                                           |
| `corepack pnpm typecheck:nuxt`                                                                                      | PASS, dependency builds, generated drift/strict fixtures, installed feature typechecks and root runtime/SFC types   | `/tmp/eve-market-graphql-logs/group4-final-typecheck.log`                                                    |
| `corepack pnpm exec nuxt typecheck` after final rejection adapter fix                                               | PASS                                                                                                                | `/tmp/eve-market-graphql-logs/group4-final-adapter-typecheck.log`                                            |
| `corepack pnpm test:graphql:packages`                                                                               | PASS, isolated installed SDK/Market contracts including the nonpersistent factory type fixture                      | `/tmp/eve-market-graphql-logs/group4-packages.log`                                                           |
| `corepack pnpm test:frontend`                                                                                       | PASS, 1,023 frontend tests and 351 mounted UI tests, including 8 query lifecycle tests and the real persister proof | `/tmp/eve-market-graphql-logs/group4-frontend.log`                                                           |
| `corepack pnpm --filter @eve-space/platform-module-nuxt test`                                                       | PASS, 103 tests including nonpersistent metadata enforcement                                                        | `/tmp/eve-market-graphql-logs/group4-platform-tests.log`                                                     |
| `corepack pnpm --filter @eve-space/market-nuxt test`                                                                | PASS, 35 tests including generated selection adapters and retained presentation semantics                           | `/tmp/eve-market-graphql-logs/group4-market-tests.log`                                                       |
| `corepack pnpm exec vitest run --config vitest.registry.config.ts tests/platform/module-package-boundaries.test.ts` | PASS, 164 tests                                                                                                     | `/tmp/eve-market-graphql-logs/group4-package-boundary-tests.log`                                             |
| `corepack pnpm exec tsx scripts/verify-nuxt-module-boundaries.ts`                                                   | PASS                                                                                                                | `/tmp/eve-market-graphql-logs/group4-final-boundaries.log`                                                   |
| `corepack pnpm exec tsx scripts/verify-esi-query-persistence.ts`                                                    | PASS, original persistence-grant and auto-refetch prohibitions preserved                                            | `/tmp/eve-market-graphql-logs/group4-persistence-boundaries.log`                                             |
| `corepack pnpm exec tsx scripts/verify-query-persistence-boundaries.ts`                                             | PASS                                                                                                                | `/tmp/eve-market-graphql-logs/group4-host-persistence-boundaries.log`                                        |
| `corepack pnpm exec tsx scripts/verify-graphql-boundaries.ts`                                                       | PASS                                                                                                                | `/tmp/eve-market-graphql-logs/group4-graphql-boundaries.log`                                                 |
| Scoped `oxlint`, `oxfmt --check`, and `git diff --check`                                                            | PASS                                                                                                                | `/tmp/eve-market-graphql-logs/group4-final-lint.log`, `/tmp/eve-market-graphql-logs/group4-final-format.log` |

The final suites above passed 1,676 tests; focused diagnostic reruns are not counted again. OpenSpec
progress is 12/23 tasks complete. Work stops after group 4; no group 5–7 task is marked complete.

## Group 5 completion (2026-10-03)

Tasks 5.1–5.3 complete the observation-pinned read/traversal boundary. A complete `MarketBook`
selection enables one generated `MarketInitialOrders` operation with nullable seller/buyer aliases,
100 rows per side, and shared summary/table consumers. Concurrent equivalent consumers collapse
into one request. Executed alias errors preserve a successful sibling and truthful unknown summary
values. Same-selection refresh failures keep valid prior rows/source clocks; an unavailable
observation removes its affected rows, including a continuation currently displayed when the shared
initial side subsequently fails. Rejected operations remain query failures.

`useMarketOrderPage` owns reactive Colada continuation definitions with generated contract identity,
profile/revision/type/observation/side/100/exact-cursor keys. Each displayed side has at most 100
rows. Source expiry caps ten-second reuse; detached entries expire after five minutes and retain
the shared explicit nonpersistence classification. Previous traversal reuses eligible cache entries
and the latest 50 issued page-start cursors. At the retention boundary, backward traversal stops.
No browser code decodes a cursor or reconstructs a row tuple. Scroll traversal retains
loading/retry and local sorting behavior.

Type, profile, profile revision and observation changes synchronously reset traversal, cancel the
Colada transport and fence obsolete cache release. `MARKET_OBSERVATION_UNAVAILABLE` clears the
affected visible rows and offers explicit rediscovery. Restart first refreshes book discovery;
failed discovery does not request pages. Successful discovery then refreshes initial sides and
resets both tables, including when the complete observation ID is unchanged. New observations
have separate query identities. The feature contract documents these semantics.

The final mounted owner suite contains 12 cases, including concurrent alias delivery, HTTP 400
rejection, partial/retained sides, all four selection resets, oversized-page rejection, exact opaque
cursors, forward/backward reuse, explicit retry, fifty-cursor traversal, source expiry, actual
five-minute detached cache eviction, and observation restart. Controlled removal of the unavailable
initial-side guard and same-observation restart reset made both regressions fail for the intended
reasons (`group5-regression-control.log`). A third test failed before the final table invalidation
fix, retaining three obsolete continuation rows (`group5-initial-invalidation-control.log`).

The production browser journey uses the real built Market page, generated operations, configured
credentialed transport, actual endpoint execution/selection policy, and controlled Market resolver
fixtures. It verifies keyboard paging on a 390px viewport, opaque continuation, return to page zero,
scroll-triggered unavailable continuation, row removal and explicit restart. Initial execution
failed because the fixture allowed `localhost:3002` while the runner used a random origin; CORS
blocked the POST before the fixture route. The journey now explicitly configures the runner and
fixture to the same `http://127.0.0.1:3002` origin. This is test configuration, with no production
CORS policy change. Other group 6 journeys were skipped and remain unchecked.

| Check                                                                                                                                                                            | Result                                                                                                                                                     | Log path                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `corepack pnpm typecheck:nuxt`                                                                                                                                                   | PASS, dependency/artifact prerequisites and installed Nuxt/root checks                                                                                     | `/tmp/eve-market-graphql-logs/group5-typecheck.log`                                                                                                                      |
| `corepack pnpm typecheck:nuxt:local` after the final table invalidation fix                                                                                                      | PASS, installed Nuxt/root runtime and SFC types                                                                                                            | `/tmp/eve-market-graphql-logs/group5-final-typecheck.log`                                                                                                                |
| `corepack pnpm test:frontend`                                                                                                                                                    | PASS, 1,023 root tests and 362 mounted tests before the final table invalidation case                                                                      | `/tmp/eve-market-graphql-logs/group5-frontend.log`                                                                                                                       |
| Final affected mounted UI suite                                                                                                                                                  | PASS, 363 tests including all 12 order owner cases                                                                                                         | `/tmp/eve-market-graphql-logs/group5-final-ui.log`                                                                                                                       |
| `corepack pnpm --filter @eve-space/market-nuxt test`                                                                                                                             | PASS, 35 tests                                                                                                                                             | `/tmp/eve-market-graphql-logs/group5-market-tests.log`                                                                                                                   |
| `corepack pnpm test:e2e:build`                                                                                                                                                   | PASS, production browser artifact rebuilt after the final table fix                                                                                        | `/tmp/eve-market-graphql-logs/group5-browser-build.log`                                                                                                                  |
| `EVE_SPACE_E2E_PERSISTENCE_FIXTURE=1 corepack pnpm exec vitest run --config vitest.e2e.config.ts features/market/nuxt/test/market-graphql.e2e.test.ts -t 'follows opaque pages'` | PASS, 1 production keyboard/mobile/scroll/restart journey; 3 group 6 journeys skipped                                                                      | `/tmp/eve-market-graphql-logs/group5-browser.log`                                                                                                                        |
| Nuxt module, feature persistence, host persistence and GraphQL boundary verifiers                                                                                                | PASS, original import/persistence/auto-refetch guards preserved                                                                                            | `/tmp/eve-market-graphql-logs/group5-boundaries.log`                                                                                                                     |
| Scoped standard lint, quality-rule diagnostics, formatting and diff checks                                                                                                       | PASS on group 5 files; no quality baseline expansion                                                                                                       | `/tmp/eve-market-graphql-logs/group5-scoped-lint.log`, `/tmp/eve-market-graphql-logs/group5-quality-summary.log`, `/tmp/eve-market-graphql-logs/group5-final-format.log` |
| `corepack pnpm lint`                                                                                                                                                             | FAIL, 19 outstanding quality findings in earlier-group adapters/generated contracts/read queries/test fixtures; group 5 files have no new quality findings | `/tmp/eve-market-graphql-logs/group5-lint.log`                                                                                                                           |
| `corepack pnpm format:check`                                                                                                                                                     | FAIL, pre-existing user `AGENTS.md` and `CLAUDE.md` edits; preserved                                                                                       | `/tmp/eve-market-graphql-logs/group5-format-check.log`                                                                                                                   |

Final owner suites cover 1,422 tests (1,023 root + 363 mounted + 35 feature + 1 browser); diagnostic
reruns are not counted again. OpenSpec progress is 15/23 tasks complete. Repository-wide quality
findings and the remaining group 6–7 implementation/full matrix are not waived or reported as
passing. SSR/hydration request parity, history-demand completion, other browser journeys,
comparison measurements, live deployment and rollback verification remain pending. Stop after
group 5; no group 6–7 task is marked complete.

## Group 6 initial verification (2026-10-03)

The review subsequently reproduced an uncollected SSR warning missed by the initial assertion.
The review-correction evidence below supersedes that case and the lint/runtime compilation
failures recorded in this historical section.

Tasks 6.1–6.4 finish staged public rendering, the history command seam, canonical browser
journeys and this scoped review. `MarketPage.vue` awaits catalogue discovery, identity/profile
queries, the active book/history resource and, for an eligible complete book, shared initial
sides. The book-to-orders transition explicitly settles reactive selectors before refreshing
initial sides. The established Colada Nuxt payload transfers successful resources without a
second cache. All nine feature-owned production-browser cases execute the actual built page,
generated documents, configured platform transport, installed SDL/scalars and real GraphQL
execution/selection policy with controlled resolver data. Final UI tests retain Browse, search,
Quickbar, accessible history alternatives, profile eligibility and local order sorting.

### Final consumer-to-mounted-field inventory

All generated operations below send JSON POST to `/graphql`, mounted at
`api/src/index.ts:68` behind the existing exact-origin CSRF/CORS policy. `graphql/routes.ts`
binds the application schema and `graphql/request-execution.ts` calls shared module admission
with a null session for each `strategy: public` read. The enabled Market contribution and
its exact declared read capabilities still control execution. Nested selected fields project
these intentional resources; they do not add collection authority. The manifest's root,
catalogue-type, profiles, book, orders and history read strategies are all public.

Query keys begin with `market/graphql`, the generated schema/document identities and operation
name. The selector column lists the remaining result-changing identity. All pilot entries opt
out of browser persistence, retain five-minute detached residency and zero automatic retries,
and preserve existing mount/focus/reconnect policy. Source freshness, client reuse, residency
and POST `no-store` remain separate policies.

| Consumer / operation                                                            | Selected field and final source owner                                                                                                                                                      | Selectors, activation and SSR                                                                                                      | Client freshness / source clock                                                                                                | Persistence / write authority                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `useMarketReadQueries.ts`, `MarketItem`                                         | `MarketRead.catalogueType`: revision plus item ID/group/name; `graphql-catalogue.ts` → `readMarketCatalogue`, core `market-catalogue` product                                              | Catalogue revision + type; selected item, public SSR and browser                                                                   | Immutable within pinned revision; revision identifies source                                                                   | None; core-data read only                                                                                     |
| `useMarketReadQueries.ts`, `MarketProfiles`                                     | `MarketRead.profiles`: profile ID/revision/region/scope/mode/stations/watched types; `graphql-book.ts` → `readEnabledMarketProfiles`                                                       | Shared discovery, public SSR and browser; profile revision binds subsequent resources                                              | 30 seconds; independent of book/history                                                                                        | None; `list-market-profiles` only                                                                             |
| `useMarketOrderBook.ts` → `useMarketReadQueries.ts`, `MarketBook`               | `MarketRead.book`: selected profile/revision/type, status, collection state, replacement attempt and complete observation; `graphql-book.ts` → `readMarketBookState`                       | Profile ID/revision + type; order tab only, public SSR and browser                                                                 | At most 10 seconds, shortened by observation `freshUntil`; keeps `observedAt` / `validatedAt` and replacement attempt distinct | None; enabled profile, observation and replacement reads                                                      |
| `useMarketOrderBook.ts` → `useMarketInitialOrders.ts`, `MarketInitialOrders`    | Nullable `sellers` / `buyers` aliases of `MarketRead.orders`: observation, rows and labels, completeness, `nextCursor`; `graphql-book.ts` → `readMarketOrderPage`                          | Profile ID/revision + type + observation + 100; complete order-tab observation only; public SSR and browser; shared summary/tables | At most 10 seconds, capped by observation source expiry                                                                        | None; profile/observation/order-row reads and `static-location-labels` core product                           |
| `useMarketOrderPaging.ts` → `market-order-query.ts`, `MarketOrderContinuation`  | One `MarketRead.orders` side with the same row/observation/page metadata and opaque continuation                                                                                           | Profile ID/revision + type + observation + side + 100 + exact `after`; explicit browser paging/retry only                          | At most 10 seconds, capped by returned observation expiry; last 50 known page-start cursors                                    | None; same read grants as initial aliases                                                                     |
| `useMarketReadQueries.ts`, `MarketHistory`                                      | `MarketRead.history`: profile/revision/type/region, status/freshness, validation/expiry and date/average/high/low/volume/order count; `graphql-statistics.ts` → `readEnabledMarketHistory` | Profile ID/revision + type; history tab only, public SSR and browser                                                               | At most 60 seconds, capped by history `freshUntil`; independent of order observation                                           | None; profile and daily-history reads, no demand/scheduling grant                                             |
| `MarketPage.vue` and retained Browse/search/Quickbar composables                | GET `/api/modules/market/catalogue/revision`, pinned tree, group pages and search index; mounted public catalogue contribution                                                             | Current catalogue discovery/pinned revision, group/cursor/search activation; existing public SSR/browser boundaries                | Existing catalogue policies unchanged                                                                                          | Existing retained REST policy; no selected-item REST fallback                                                 |
| `useMarketHistoryRequest.ts`, ready/refetch callbacks in `useMarketOverview.ts` | POST `/api/modules/market/history-intent/profiles/:profileId/types/:typeId/demand`; `history-routes.ts:marketHistoryDemandRoutes`, mounted installed public mutation contribution          | Mounted client, active eligible profile/revision/type only; no SSR command                                                         | Four-second checks in a 90-second polling window, explicit retry; ready preserves original history source timestamps           | No command persistence; separate `request-market-history-demand` capability, never granted to GraphQL history |

The exact operation selections remain in `market-operations.graphql`; there is no reference-price
selection. IDs/counts require checked conversion and exact ISK stays a string. The source readers
and mounted REST routes remain available for a compatible frontend rollback. No server field,
ESI call, write grant, persistence grant, operation limit or global refresh policy changed.

### Scoped results and owning evidence

| Check                                                                                      | Result                        | Implementation / executed evidence                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-01 / MOD-06, QUERY-04: approved transport and generated feature contracts              | PASS                          | Platform runtime leaves and Market generated documents; package/drift prerequisites in `group6-typecheck.log`, actual production transport in `group6-browser.log`; boundary verifiers in `group6-boundaries.log`                                                                                                      |
| AUTH-01 / AUTH-02 / AUTH-03 / AUTH-07: anonymous public SSR and credential boundaries      | PASS                          | Final mount/read admission above; browser case `renders anonymous regional and Global PLEX links...` asserts each selected operation once, no forwarded synthetic incoming cookie, and only public SSR paths                                                                                                           |
| QUERY-01 / QUERY-03: complete identities and obsolete completions                          | PASS                          | Full generated keys and captured/returned selector guards; final UI query/order owner suites plus browser `discards a delayed prior market...` keep PLEX rows/profile after delayed regional work                                                                                                                      |
| QUERY-05: rejected operation, partial field and domain states remain distinct              | PASS                          | HTTP 400 initial-order browser navigation has one failed target request, no REST fallback and no empty/uncollected copy; nullable buyer failure retains seller rows and unknown buy summary; adapter/query suites run in final frontend/feature logs                                                                   |
| QUERY-06: command completion updates only its exact resource                               | PASS                          | Named `MarketHistoryResource` uses the common presentation model, independent selectors and explicit `graphql` / `history-demand` provenance; actual ready owner test checks the exact key, clocks and delayed-read rejection. Restoring the old REST key fails that test (`group6-ready-regression-control.log`)      |
| TIME-03 / TIME-04 / TIME-07: independent source clocks, bounded reuse and retained success | PASS                          | Source-capped query options, truthful stale/failed refresh presentation, same-selection history/book/order owner tests; command completion retains source metadata; existing request workflow alone owns bounded polling                                                                                               |
| PERSIST-01 / PERSIST-02 / PERSIST-04: pilot excluded while SSR/memory reuse remains        | PASS                          | Explicit nonpersistent options; real persister proof from group 4 runs in the final frontend suite with an eligible positive control; zero browser selected reads on successful SSR hydration in production journeys                                                                                                   |
| ESI-05 / ESI-07 / ESI-08 at the consumer boundary: cancellation, retries and bounded pages | PASS                          | Final order owner tests exercise actual transport aborts, finite cursor history/residency and exact opaque cursor; production keyboard/mobile/scroll/restart journey passes; no new upstream ESI attempt is introduced                                                                                                 |
| History read has no collection grant or SSR command                                        | PASS                          | Manifest/history resolver inventories above; history-only and uncollected production SSR have no command; mounted ready/accepted commands are separate POSTs. Command counters exclude CORS OPTIONS preflights                                                                                                         |
| History completion, queued state, pause, timeout, retry and previous-target outcomes       | PASS                          | Final mounted history ready/polling tests and four type/profile/revision/tab delayed-ready cases; production accepted-queued journey performs SSR read + immediate check + four-second check, one REST POST, no inactive book or REST history read                                                                     |
| Public hydration and tab activation                                                        | PASS                          | Anonymous regional/PLEX order and history links: each successful selected operation once, zero browser duplicates and zero hydration/page errors; inactive tab resources excluded; uncollected books request no initial aliases                                                                                        |
| Retained Browse/search/Quickbar and accessible value alternatives                          | PASS                          | Final canonical UI suite (367 tests) retains existing owners; production search/profile/PLEX race and keyboard/mobile paging journeys execute live controls rather than stubbing composables                                                                                                                           |
| Backend ESI cache/coordination, private admission and database/worker deployment           | N/A to group 6 consumer edits | Those owners are unchanged. This is not a backend-runtime pass; full shared-contract/runtime validation remains required in group 7                                                                                                                                                                                    |
| Repository-wide lint                                                                       | FAIL                          | 15 earlier anti-slop findings remain, down from 19 after removing findings on touched resource/test boundaries; no baseline expansion. `group6-lint.log`                                                                                                                                                               |
| Repository-wide formatting                                                                 | FAIL                          | Pre-existing `AGENTS.md` and `CLAUDE.md` edits only; preserved. `group6-format-check.log`                                                                                                                                                                                                                              |
| Wider Market runtime diagnostic typecheck                                                  | FAIL                          | Normal Nuxt check does not include every feature runtime file. An explicit host-augmented diagnostic found two untouched Browse/Quickbar errors at `useMarketGroupItems.ts:71` (readonly array) and `market-quickbar-sort.ts:70` (JSON input contract). `group6-runtime-typecheck.log`; no whole-runtime compile claim |
| Full matrix, live deployment and release/rollback probes                                   | BLOCKED                       | Not executed in this authorized group; all group 7 tasks remain unchecked. Fixture/local source passes are not deployment evidence                                                                                                                                                                                     |

The additional compiler check exposed two scoped errors that are fixed: cancellation now retains
its selector tuple separately from activation, and the common history result uses the existing
presentation type instead of requiring GraphQL-only selector fields on a REST ready DTO. The
focused query-owner compile includes the real host API augmentation and passes
(`group6-query-typecheck.log`); the normal installed Nuxt/root typecheck also passes after these
fixes (`group6-final-typecheck.log`). The wider diagnostic's two retained errors above remain
explicit follow-up work, alongside the repository-wide quality findings, for final validation.

### Same-fixture before/after measurements

The final probe runs the matching `.output-e2e` production bundle after the last query fix,
with the same regional/Global PLEX rows and source timestamps as the group 1 REST baseline.
`group6-measure.mts` starts the GraphQL fixture on 9876, the same transparent measurement
proxy on 9877, production Nuxt on 3002, and the same Playwright phase actions/readiness
selectors. It also measures the native market summary's visible milestone. All probe-owned
processes close on completion. The final sample runs after the validation runners finish.
The production test build adds the existing persistence-fixture route; it uses the real Market
page and records shell requests separately. This is a local fixture comparison, not a live
backend benchmark or a release performance threshold.

Read counts include retained Market GETs plus GraphQL POSTs; response bytes are compressed body
bytes, excluding headers. Generated POST body bytes include the document and variables. CORS
OPTIONS, shell reads and REST history commands are kept in raw records and excluded from read
counts/bytes. Latency is summed per-read proxy/API response latency, not upstream ESI latency.
Header/visible milestones are elapsed time from the phase action. Baseline summary timing was
not separately captured and is not fabricated; its original header/first-row milestones remain
in the baseline table. Timings below are individual local samples and establish no speed claim.

| Phase                              | REST → pilot reads | REST → pilot response bytes | Pilot POST body bytes | REST → pilot summed API ms | REST → pilot header ms | Pilot summary ms | REST → pilot rows/chart ms | Pilot browser selected reads |
| ---------------------------------- | -----------------: | --------------------------: | --------------------: | -------------------------: | ---------------------: | ---------------: | -------------------------: | ---------------------------: |
| cold regional SSR and hydration    |              5 → 6 |                 1152 → 1394 |                  2401 |               2.54 → 20.29 |        159.94 → 188.07 |           216.27 |            173.22 → 225.98 |                            0 |
| history activation                 |              1 → 1 |                   490 → 551 |                   495 |               2.55 → 12.29 |          45.77 → 81.06 |                — |              53.83 → 82.18 |                            1 |
| warm selection return              |              3 → 4 |             101791 → 102028 |                  2195 |              17.25 → 23.30 |        180.38 → 181.55 |           182.27 |            181.56 → 183.35 |                            4 |
| cold Global PLEX SSR and hydration |              5 → 6 |                 1146 → 1393 |                  2407 |                3.04 → 9.53 |        155.51 → 123.89 |           166.06 |            170.55 → 183.70 |                            0 |
| history deep link                  |              5 → 5 |                 1185 → 1207 |                  1001 |                3.08 → 8.80 |         90.85 → 111.39 |                — |             96.64 → 124.46 |                            0 |
| order continuation forward         |              1 → 1 |                   319 → 456 |                  1168 |                1.43 → 4.63 |          52.10 → 68.29 |                — |              54.17 → 70.94 |                            1 |
| order continuation return          |              0 → 0 |                       0 → 0 |                     0 |                0.00 → 0.00 |          22.19 → 21.70 |                — |              25.68 → 25.07 |                            0 |

Cold order links make six reads instead of five because book discovery precedes the shared side
operation. The warm selection phase likewise adds that stage (four reads instead of three),
including the unchanged large REST search index. History activation and forward continuation
still each use one read; returning to the initial page uses no network read. Successfully
prefetched selected resources cause zero browser hydration reads for regional orders, PLEX
orders and the history deep link. The browser journeys independently verify both regional and
PLEX history hydration. Source/order page bounds remain unchanged.

The pilot increases request bodies and selected response bytes; it does not demonstrate a
request-count or latency improvement. It provides generated contracts, independent field
outcomes, observation/cursor identity and managed continuation reuse/cancellation. The additional
book-to-orders stage and loss of GET response cacheability are retained trade-offs, with source
caching and Colada reuse still independent. History source reads do not record demand. The
retained mounted command returns controlled fixture 503 during these ordinary history phases,
versus fixture 404 in the baseline; those command outcomes are excluded from the read comparison.
Ready and accepted completion behavior is measured by the separate passing browser/owner tests.

Reproduction and raw evidence: `corepack pnpm exec tsx
/tmp/eve-market-graphql-logs/group6-measure.mts` exits 0; `graphql-after.json` contains every
phase/request, `group6-measure.log` and `group6-measure-nuxt.log` retain execution logs. Compare
with the preserved `rest-baseline.json` / `baseline.mjs` / `measure-proxy.mjs` in the same directory.
The measurements use controlled endpoint resolvers and do not establish production database,
worker, admission, CDN, remote latency or target-deployment behavior.

### Executed group 6 verification

| Exact command / probe                                                                                                                                  | Exit / result                                                                          | Log path                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm typecheck:nuxt`                                                                                                                         | 0; dependency builds, generated drift/strict contracts, installed Nuxt and root checks | `/tmp/eve-market-graphql-logs/group6-typecheck.log`                                                              |
| `corepack pnpm typecheck:nuxt:local` after final query fixes                                                                                           | 0; installed Nuxt/root checks                                                          | `/tmp/eve-market-graphql-logs/group6-final-typecheck.log`                                                        |
| `corepack pnpm exec vue-tsc --noEmit --project /tmp/eve-market-graphql-logs/group6-query-tsconfig.json`                                                | 0; selected query owners plus real host API type augmentation                          | `/tmp/eve-market-graphql-logs/group6-query-typecheck.log`                                                        |
| `corepack pnpm exec vue-tsc --noEmit --project /tmp/eve-market-graphql-logs/group6-runtime-tsconfig.json`                                              | 2; two untouched Browse/Quickbar errors, recorded above                                | `/tmp/eve-market-graphql-logs/group6-runtime-typecheck.log`                                                      |
| `corepack pnpm test:frontend`                                                                                                                          | 0; 1,023 root + 367 mounted tests before final typing/cancellation adjustment          | `/tmp/eve-market-graphql-logs/group6-frontend.log`                                                               |
| `corepack pnpm exec vitest run --config vitest.ui.config.ts` after final query fixes                                                                   | 0; all 367 mounted tests, including actual ready/polling/order/persistence owners      | `/tmp/eve-market-graphql-logs/group6-final-ui.log`                                                               |
| `corepack pnpm --filter @eve-space/market-nuxt test`                                                                                                   | 0; 35 adapter/presentation/feature tests                                               | `/tmp/eve-market-graphql-logs/group6-market-tests.log`                                                           |
| `corepack pnpm test:e2e:build` after final query fixes                                                                                                 | 0; matching production browser bundle                                                  | `/tmp/eve-market-graphql-logs/group6-browser-build.log`                                                          |
| `EVE_SPACE_E2E_PERSISTENCE_FIXTURE=1 corepack pnpm exec vitest run --config vitest.e2e.config.ts features/market/nuxt/test/market-graphql.e2e.test.ts` | 0; all nine actual production journeys, no skipped cases                               | `/tmp/eve-market-graphql-logs/group6-browser.log`                                                                |
| Nuxt module, feature/host persistence and GraphQL boundary verifiers                                                                                   | 0; commands recorded in log, guards unchanged                                          | `/tmp/eve-market-graphql-logs/group6-boundaries.log`                                                             |
| Scoped standard lint and configured anti-slop/complexity diagnostics                                                                                   | 0 standard lint; zero scoped quality/complexity findings, no allowance expansion       | `/tmp/eve-market-graphql-logs/group6-scoped-lint.log`, `/tmp/eve-market-graphql-logs/group6-quality-summary.log` |
| Scoped formatting and `git diff --check`                                                                                                               | 0                                                                                      | `/tmp/eve-market-graphql-logs/group6-final-format.log`, `/tmp/eve-market-graphql-logs/group6-diff-check.log`     |
| `corepack pnpm lint`                                                                                                                                   | 1; 15 outstanding earlier findings, scoped group 6 changes clean                       | `/tmp/eve-market-graphql-logs/group6-lint.log`                                                                   |
| `corepack pnpm format:check`                                                                                                                           | 1; pre-existing user guide edits only                                                  | `/tmp/eve-market-graphql-logs/group6-format-check.log`                                                           |

The final owner suites cover 1,434 tests (1,023 root + 367 mounted + 35 feature + 9 browser);
diagnostic/overlapping reruns are not counted twice. Canonical `vitest.e2e.config.ts` includes the
feature-owned browser file; the feature's unit config excludes browser tests. Existing root
browser journeys were retained and were not relocated without behavior. The full repository
browser runner and other group 7 integration/matrix commands have not been run in this group.

OpenSpec progress is 19/23 tasks complete. Group 6 is complete within the source/fixture scope;
repository-wide quality and wider-runtime compiler findings are explicitly retained. Stop before
group 7. No live deployment, archive, commit, push or API/worker data change was performed.

## Review corrections (2026-10-03)

The six requested findings are repaired at their owners. Task 6.1 was reopened during the repair
and marked complete again only after the strengthened production SSR assertion passed.
OpenSpec remains 19/23 complete; group 7 is not marked complete or deployed.

| Finding                               | Correction and owning proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uncollected SSR false failure         | `useMarketOrderBook.load()` checks successful discovery and complete-observation eligibility before refreshing initial sides. Presentation distinguishes uncollected coverage from retained observed data. The existing production uncollected case now rejects unavailable-source and retained-observation warnings while checking zero initial requests. `review-ssr-before.log` failed against the old production artifact for the intended warning; `review-browser.log` passes against the rebuilt artifact.                                                                                                         |
| Book sequencing exposed to callers    | `useMarketOrderBook` owns discovery, eligibility, initial aliases, combined presentation, selection/lifecycle fencing and same/new-observation restart. The page calls `orders.load()` and `orders.restart()`; it does not coordinate both queries or Vue update timing. Queries retain separate identities and source clocks. The owning tests exercise shared consumers, partial-side retention, rejection and failed/same-observation rediscovery through this interface.                                                                                                                                              |
| Traversal lifecycle in the table      | `useMarketOrderPaging` owns issued cursors, current page, retained rows, selector construction, cancellation, retry and observation invalidation. The table keeps sorting, rendering and DOM positioning. Existing tests now exercise the paging interface, including fifty issued starts, expiry/residency, side-specific invalidation, delayed type/profile/revision/observation changes, side changes and unmount. DOM and production keyboard/mobile tests preserve action wiring and positioning.                                                                                                                    |
| Adapter-derived incomplete models     | `market-models.ts` defines stable contracts using `MarketOrderPresentation` and `MarketDay`. Observed books require revision; ready/unavailable sides are distinct; `hasMore: true` requires an opaque cursor. Adapters accept generated selections and return these contracts. No revision zero fallback remains in paging. The authoritative compiler includes `test/types/presentation.ts`, which rejects missing revision/cursor and invalid unavailable-side states.                                                                                                                                                 |
| Fifteen lint findings                 | Metadata classification belongs to the platform `query-error.ts` seam through `toGraphQLFieldError`, reused by transport and Market field projection. Side failure conversion accepts a classified code. Test envelopes use the SDK JSON contract, captured resources have a named contract, and assertions state their serialization invariant. The generator emits schema/code-generation justifications for all six typed documents. Full lint passes with both baseline files unchanged. The new GraphQL allowlist tests use a focused suite instead of changing the pre-existing large suite's baselined callback.   |
| Incomplete routine typecheck coverage | `typecheck:nuxt:local` invokes `typecheck:market:runtime`; the feature-owned `features/market/nuxt/tsconfig.runtime.json` includes every Market runtime TS/SFC, prepared Nuxt declarations, the existing host API augmentation and the presentation fixture. Browse copies the readonly response into its mutable list. Quickbar folders use a closed object type assignable to the existing JSON decoder input, preserving validation and hierarchy checks. Restoring both original mismatches makes this new command fail on exactly those two files (`review-runtime-negative-control.log`); restored repairs compile. |

The graph index did not resolve the new runtime symbols and returned UNKNOWN impacts. Source
imports/call sites, package exports, Nuxt registration and actual runners provided the scoped
fallback. Generator and shared error-leaf impacts were LOW. No higher-risk graph verdict was waived.

### Executed review verification

Logs are under `/tmp/eve-market-graphql-logs/`. Artifact writers finished sequentially before
dependent tests. No source or test file was edited while Vitest ran.

| Command                                                                                                       | Result                                                                                                                                                                         | Log                             |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `pnpm graphql:generate`                                                                                       | PASS; generator-owned justifications persist through regeneration                                                                                                              | `review-generate.log`           |
| `pnpm lint`                                                                                                   | PASS; 1,693 existing anti-slop and 95 complexity allowances verified, none added                                                                                               | `review-lint-final.log`         |
| `pnpm typecheck:nuxt`                                                                                         | PASS; installed prerequisites and authoritative whole-Market runtime check                                                                                                     | `review-typecheck-nuxt.log`     |
| `pnpm typecheck:nuxt:local` after final source edits                                                          | PASS; includes `typecheck:market:runtime` and presentation rejection fixture                                                                                                   | `review-final-typecheck.log`    |
| `pnpm --filter @eve-space/platform-module-nuxt typecheck`                                                     | PASS; package and independent Nuxt runtime fixture                                                                                                                             | `review-platform-typecheck.log` |
| `pnpm test:graphql:packages`                                                                                  | PASS; drift/types and actual isolated tarball consumers                                                                                                                        | `review-package-isolation.log`  |
| `pnpm test:frontend`                                                                                          | PASS; 1,023 root tests and 369 mounted UI tests                                                                                                                                | `review-frontend.log`           |
| `pnpm --filter @eve-space/market-nuxt test`                                                                   | PASS; 35 presentation/adapter tests                                                                                                                                            | `review-market-tests.log`       |
| `pnpm --filter @eve-space/platform-module-nuxt test`                                                          | PASS; 107 tests across 17 files, including the 11 transport/metadata cases                                                                                                     | `review-platform-tests.log`     |
| Focused platform GraphQL transport diagnostic                                                                 | PASS; 11 tests, included in the full package count above                                                                                                                       | `review-transport-tests.log`    |
| Market production browser file under `vitest.e2e.config.ts` with the existing persistence-fixture environment | PASS; all nine journeys, including strengthened uncollected SSR                                                                                                                | `review-browser.log`            |
| `pnpm --filter @eve-space/api typecheck`                                                                      | PASS                                                                                                                                                                           | `review-api-typecheck.log`      |
| `pnpm --filter @eve-space/api test:coverage`                                                                  | PASS; 2,954 tests and configured thresholds; statements 82.69%, branches 76.68%, functions 85.45%, lines 82.72%                                                                | `review-api-coverage.log`       |
| `pnpm --filter @eve-space/api test:postgres`                                                                  | PASS; 443 tests using isolated Testcontainers infrastructure                                                                                                                   | `review-postgres.log`           |
| `pnpm --filter @eve-space/api test:redis`                                                                     | FAIL on first run: 65 passed, one worker scheduler test reported `Connection is closed`                                                                                        | `review-redis.log`              |
| Same Redis command rerun alone after other suites finished                                                    | FAIL; Vitest worker fork exited unexpectedly, only 21/66 tests completed. Partial coverage also falls below configured thresholds; this does not establish full-suite coverage | `review-redis-isolated.log`     |
| `pnpm --filter @eve-space/api build`                                                                          | PASS                                                                                                                                                                           | `review-api-build.log`          |
| `pnpm build`                                                                                                  | PASS; matching production Nuxt artifact                                                                                                                                        | `review-nuxt-build.log`         |
| `pnpm test:e2e:build`                                                                                         | PASS; matching controlled production browser artifact                                                                                                                          | `review-browser-build.log`      |
| `pnpm format:check`                                                                                           | FAIL only on the preserved pre-existing `AGENTS.md` and `CLAUDE.md` edits; authored files formatted separately                                                                 | `review-format-check.log`       |

The before/after transport figures in the initial group 6 section remain historical measurements
from before this ownership refactor. The generated query strings, complete-observation call stages,
query identities, source clocks, limits and persistence policy are preserved; no new performance
measurement or speed improvement is claimed here. These source/controlled-build checks do not
establish live deployment behavior. Full group 7 integration runners and runtime deployment/probes
remain pending; no commit, release, archive, schema expansion, data migration or live data change was made.

Redis verification is not marked PASS: the first run reported a closed connection and the
isolated attempt lost a Vitest worker fork before completing the suite. Queue/ESI runtime and
Redis integration source were not edited, and thresholds were not weakened. Partial coverage
from the aborted attempt cannot establish an independent coverage deficit. The Redis runner
failure remains an unresolved broader verification blocker alongside repository formatting,
visible for group 7. No backend cleanup or live Redis/PostgreSQL data change was included in
these six corrections.
