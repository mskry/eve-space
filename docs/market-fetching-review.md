# Market fetching compliance review

## Scope

This review covers every request path introduced by the Market module: the SDE catalogue browser and search index, public profiles, order books and paged rows, depth quotes, daily history and its on-demand collection, reference prices, deployment profile administration, private structure markets, and the background collectors behind them. Governing policy: root `AGENTS.md`, `api/src/esi-gateway/AGENTS.md`, `features/market/server/AGENTS.md`, and [the fetching-layer compliance checklist](fetching-layer-compliance-checklist.md). Source-operation metadata and measurements are in the [ESI source review](market-intelligence-source-review.md); limits and identities are in the [delivery contract](../features/market/docs/contract.md).

It consolidates the reviews made while the module was developed on `feat/market-browser` (catalogue, intelligence server, overview UI, and follow-up review fixes). Later changes to these paths need a new review.

## Mount and composers

`api/src/index.ts` mounts generated routes under `/api/modules` from `api/src/generated/platform/installed-module-routes.ts`. `api/src/platform/module-route-composition.ts` supplies four composers:

- **public**: checks installed-module enablement before any feature read and adds compression; no application or administrator session.
- **public-mutation**: the same gate plus trusted `WEB_ORIGIN`.
- **administrator**: deployment-administrator session after module enablement.
- **owned-character**: application session, current organization admission, `market.structure.read`, and owned-character middleware before ESI scope checks.

The Market manifest declares `defaultEnabled: true`, independently of whether any collection profile is enabled. Explicit disablement returns 404 before module persistence or core-data reads.

## Request inventory

| Consumer / trigger                                      | Identity and inputs                                                        | SSR                                                  | Final route or execution                                                                                              | Composer                                                                         | Source and persistence                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `MarketPage.vue` current tree                           | Stable current-tree key; response carries revision and tree together       | Yes, Colada payload                                  | GET `/market/catalogue/revision`, then `/market/catalogue/body/:revision/tree`                                        | public                                                                           | Committed SDE `market-catalogue`; discovery ETag, immutable revision body; no ESI                   |
| `MarketCatalogueTreeNode.vue` group items               | Revision, group ID, opaque cursor                                          | Browser only, expansion and observed list end        | GET `/market/catalogue/body/:revision/groups/:groupId/types?cursor=`                                                  | public                                                                           | Bounded SDE page of 100; no ESI                                                                     |
| `MarketPage.vue` search index                           | Revision                                                                   | Browser only, four search characters or Quickbar tab | GET `/market/catalogue/body/:revision/search-index`                                                                   | public                                                                           | Complete bounded SDE index; no ESI                                                                  |
| `useMarketOverview.ts` selected item                    | Revision and positive type ID                                              | Yes for direct links                                 | GET `/market/catalogue/body/:revision/types/:typeId`                                                                  | public                                                                           | Committed SDE; immutable revision-and-type ETag                                                     |
| `useMarketOverview.ts` profiles                         | Enabled public profiles (at most four)                                     | Yes                                                  | GET `/market/books/profiles`                                                                                          | public                                                                           | Module PostgreSQL; omits administrator scheduling and failure fields                                |
| `useMarketOverview.ts` current book                     | Profile ID/revision and type ID                                            | Yes on the Order book tab                            | GET `/market/books/profiles/:profileId/types/:typeId/observation`                                                     | public                                                                           | Current complete pointer and first 100 rows per side                                                |
| `MarketOrderTable.vue` scroll edges                     | Profile/type, complete observation UUID, side, price/issued/order keyset   | Browser only                                         | GET `/market/books/profiles/:profileId/types/:typeId/observations/:observationId/orders`                              | public                                                                           | Bounded pinned rows; obsolete reads aborted                                                         |
| Depth quote                                             | Profile, type, complete observation, side, quantity, locations             | Browser only                                         | POST `/market/quotes/profiles/:profileId/types/:typeId/quote`                                                         | public-mutation                                                                  | Bounded read of one observation; no ESI                                                             |
| `useMarketOverview.ts` daily history                    | Profile ID/revision and type ID                                            | Yes for history deep links, otherwise tab intent     | GET `/market/history/profiles/:profileId/types/:typeId`                                                               | public                                                                           | Independent daily PostgreSQL rows                                                                   |
| `useMarketHistoryRequest.ts` history demand and polling | Profile ID/revision, type ID, active tab                                   | Browser only, mount, tab/identity change, retry      | POST `/market/history-intent/profiles/:profileId/types/:typeId/demand`, then the history GET every 4 s for up to 90 s | public-mutation, then public                                                     | Bounded module demand (256 per region profile); committed SDE type-by-ID proof; no ESI in the route |
| Reference read                                          | Bounded sorted type IDs and source UTC hour                                | Browser only                                         | GET `/market/reference-prices?typeIds=`                                                                               | public                                                                           | Hourly module reference statistics, never a quote                                                   |
| Deployment profile control                              | Profile ID/revision/region/mode, station/type bounds                       | No                                                   | GET/PUT `/market/profiles`, GET profile status                                                                        | administrator                                                                    | Module persistence and bounded offline station-region core product                                  |
| Private structure selection/read                        | Owned character, lifecycle, generation, organization version, structure ID | No                                                   | POST/GET `/market/characters/:characterId/structures/:structureId/...`                                                | owned-character                                                                  | Generation- and version-bound private observations; `private, no-store`                             |
| Shell `usePlatformModuleRuntime`                        | Installed/enabled module state                                             | Yes                                                  | GET `/api/modules` (`moduleRuntimeRoutes`)                                                                            | Public core route                                                                | Module runtime state; no Market product read                                                        |
| Public order/history/reference work                     | Profile revision, page/type, `cachedUntil`                                 | Worker                                               | Queue-derived profile work and fixed reference-price resource                                                         | Worker reloads enabled module and current profile                                | SDK descriptors through the platform gateway; staged module publication                             |
| Private structure work                                  | Character lifecycle, generation, admission scope, bounded selector         | Worker                                               | Queue-derived on-demand structure job                                                                                 | Owner, scope and organization checks before and after; locked before publication | OAuth ESI structure pages through the gateway; outage-only stale never published as complete        |

All routes above are relative to `/api/modules` unless stated.

## Checklist results

| Checks                                                   | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MOD-01 through MOD-06; ESI-01, ESI-02                    | PASS   | Generated Hono client and intentional DTOs. Market imports platform capability contracts, not API or SDK transport. Installed operation descriptors match the five reviewed market operations, the structure scope, generated validation, compatibility, rate and cache metadata. Registry, egress and module boundary checks enforce this.                                                                                                            |
| AUTH-01, AUTH-03 through AUTH-07                         | PASS   | Distinct public, public-mutation, administrator and owned-character composers in the generated routes. Public SSR needs no forwarded cookie; mutations need trusted Origin; disabled Market prevents feature reads. No personal-order overlay exists in public DTOs.                                                                                                                                                                                   |
| AUTH-02                                                  | N/A    | No SSR-capable protected Nuxt query. A future private structure query must be client- and owner-gated or forward only the incoming cookie.                                                                                                                                                                                                                                                                                                             |
| QUERY-01 through QUERY-05                                | PASS   | Revision, revision/group/cursor, profile/revision/type and observation/side/cursor keys. Chained typed Hono routes validate IDs and cursors (group IDs and cursors use positive safe-integer bounds). Revision changes invalidate pending search-worker generations. Presentation checks each result's profile and type; history polling is fenced by target identity and poll generation so a stale loop cannot restart or mutate an inactive target. |
| QUERY-06                                                 | N/A    | The history-demand mutation returns committed fresh history or a pending phase, never an optimistic history result. A ready response cancels the matching older read before updating its public query entry; pending responses trigger bounded independent reads.                                                                                                                                                                                      |
| TIME-01, TIME-02, TIME-04, TIME-07                       | PASS   | Catalogue ETags and immutable revision bodies; separate book, history and reference source clocks; registered SDK policies keep runtime expiry, validators, cooldown and collapse. Collectors reject stale page fallback and incomplete books; SQL keeps prior complete pointers with original source times. The only browser polling is the bounded four-second, 90-second history wait after an accepted demand.                                     |
| TIME-03, TIME-05, TIME-06; PERSIST-02 through PERSIST-10 | N/A    | No Market query carries `esiPersistence`; nothing is restored from browser storage.                                                                                                                                                                                                                                                                                                                                                                    |
| PERSIST-01                                               | PASS   | Catalogue, book, history and reference results stay in memory and the SSR payload. Quickbar's localStorage holds validated public type IDs and folders only and never grants access.                                                                                                                                                                                                                                                                   |
| ESI-03 through ESI-08, ESI-10                            | PASS   | Three-way page concurrency, 512-page public and 32-page private ceilings, queue-native deduplication, PostgreSQL due repair after queue loss, cooldown and cancellation handling, complete-publication and token-generation fencing. No ad hoc fetch.                                                                                                                                                                                                  |
| ESI-09                                                   | N/A    | No name-resolution operation.                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Findings and policy notes

- No Nuxt-to-protected-route SSR finding.
- `collectionStatus` is a profile-wide failure signal and never proves a particular watched type failed; the separately scoped `replacement` field supports a selected-type incomplete claim.
- The Global PLEX Market (`19000001`) is exposed only for PLEX (`44992`) as `marketScope: global-plex`; it is never relabelled as a region or an all-regions aggregate.
- The public profile list is not the administrator `/market/profiles` route.
- The unreleased Market draft SQL is consolidated into `market-001-initial.sql`, containing only active routines. Once released, applied persistence routines cannot be replaced or dropped; corrections must use new operations in new ordered migrations.
- Market queries are not in the browser query-persistence allowlist and stay in memory.

## Runtime evidence

- **Isolated probes.** Separate Compose projects with their own PostgreSQL and Redis volumes, a version-six SDE projection and a watched Tritanium (`34`) profile in region `10000058` published complete books. Public routes returned the expected sides, a complete and a partial quote, independent history, 400 for invalid IDs, 404 for unknown identities and disabled Market, and 200 `uncollected` for a valid uncollected type. The private route returned 401 without a session and 403 without Market permission. Stacks were stopped without removing volumes.
- **Official SDE deployment.** The persistent deployment applied core migrations 019/020 and the Market module migrations without resetting its volume, published SDE build 3552227 at projection version six, and served `/market` with catalogue, search and Quickbar.
- **Global PLEX.** The Global PLEX operation returned 998 orders on one page and 424 source history days; the worker published one complete global book and 365 retained history days.
- **Full-region The Forge.** Live collection found 29,301 of 404,564 orders with a 365-day duration, which the original 90-day bound rejected. The bound is now 365 days (366 rejected); the worker then published complete 405-page books of about 404,551 orders, and a blueprint type's history intent returned 202 followed by 176 daily records.
- **Browser fixture.** `node tests/support/market-browser-smoke.mjs` against a production Nuxt build and a controlled public fixture covers SSR direct links with no duplicate hydration requests, observed-end paging, the four-character index, switching and delayed responses, desktop and 390 px layouts, disabled Market, and the Quickbar flows (pin, folders, move, import, export, drag, reload, clear).

## Remaining evidence

- An eligible, organization-admitted character with real structure-market access has not been used, so the private end-to-end probe is still open.
- Field network timing, physical mid-tier mobile performance, current-layout production performance and large-region PostgreSQL write pressure are unmeasured.
- The browser Explorer benchmark in the source review is not a gateway or database throughput measurement.

## Verification

The development reviews recorded passing runs of the full matrix: `pnpm lint`, `pnpm format:check`, API, Market server, Market Nuxt and root typechecks, API coverage, Redis and PostgreSQL integration suites, module conformance and registry tests, `pnpm test:frontend`, the API and root builds, and the browser fixture above. The route, persistence and UI contracts are exercised by `api/tests/platform/market-*-route.test.ts`, `api/tests/integration/postgres/market-*.test.ts`, `features/market/server/test/` and `features/market/nuxt/test/`.

## CI regression follow-up

The E2E job for commit `5ad7d31d` failed four existing tests:
[Actions job 109852484802](https://github.com/mskry/eve-space/actions/runs/36704822554/job/109852484802).
All four failures reproduced locally before the fixes. The SSR error-leak assertion now checks rendered main content rather than Nuxt's legitimate serialized error state; the HTTP-success, neutral-state, and visible-error guarantees remain intact.

| Check / scope                 | Result | Implementation and behavioral evidence                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01, AUTH-02              | PASS   | `usePlatformModuleRuntime.ts` requests GET `/api/modules`, mounted as the public `moduleRuntimeRoutes` in `api/src/index.ts`. SSR remains enabled; `ssrCatchError: true` preserves the query error without aborting core page rendering when the API is unavailable. The existing anonymous SSR and browser-outage cases pass, including the guard against an error appearing in rendered main content. |
| QUERY-03                      | PASS   | The failure does not fabricate enabled modules or authorization. The existing empty-data navigation fallback keeps core entries, and live session/character admission remains separate.                                                                                                                                                                                                                 |
| PERSIST-01 through PERSIST-10 | N/A    | No query-persistence metadata, private admission, or storage behavior changes.                                                                                                                                                                                                                                                                                                                          |
| Tooltip interaction           | PASS   | `UiTooltip.vue` defaults its optional Boolean `open` prop to `undefined`, matching Reka's uncontrolled mode instead of locking unbound tooltips closed. The existing mail-reader hover case passes; explicitly controlled Market tooltips retain their supplied open state.                                                                                                                             |

All 93 E2E cases, 1,324 frontend cases, and 94 platform Nuxt package cases pass after the fixes. Nuxt typechecking and the production E2E build pass. The existing suite-level complexity allowance was re-keyed after the assertion edit; its count and the rest of the baseline remain unchanged. No authorization-policy conflict was identified.

Logs are under `/var/folders/y0/8p43tkrn7rz1f8jlttdq2c900000gn/T/opencode`:

| Command                                                       | Result            | Log                             |
| ------------------------------------------------------------- | ----------------- | ------------------------------- |
| `corepack pnpm typecheck:nuxt`                                | PASS              | `market-ci-typecheck.log`       |
| `corepack pnpm test:e2e:build`                                | PASS              | `market-ci-e2e-build-after.log` |
| `corepack pnpm test:e2e:built`                                | PASS, 93 tests    | `market-ci-e2e-full.log`        |
| `corepack pnpm test:frontend`                                 | PASS, 1,324 tests | `market-ci-frontend.log`        |
| `corepack pnpm --filter @eve-space/platform-module-nuxt test` | PASS, 94 tests    | `market-ci-platform-tests.log`  |
| `corepack pnpm lint`                                          | PASS              | `market-ci-lint-final.log`      |
| `corepack pnpm format:check`                                  | PASS              | `market-ci-format-final.log`    |

## Immediate history demand follow-up

Scope: history intents and profile worker delivery, including the live requests for Void XL
(`41322`) and Master-at-Arms Cerebral Accelerator (`48582`) in Forge profile
`0dee86f5-8341-48d0-b4ac-fd1cc9f03181`. Investigation found the demand rows were durable, but
collection waited for the fifteen-minute planner and its job staggering while the browser
waited only ninety seconds. Both requests eventually collected and returned 365 days.

The public-mutation route now declares a host-owned profile wake-up capability. The compiler
restricts it to deployment profile resources and trusted-origin mutations; public GET remains
read-only. Fast responses carry committed fresh history. Pending responses distinguish
saved/waiting, queued, and actual active work. The worker targets the requested demanded type,
rechecks current profile/module eligibility, and continues through the registered ESI gateway.
The year-long history policy, source clocks and independent periodic recovery remain intact.

The ready-response browser path cancels a superseded read before setting the matching public
query entry. Mounted coverage verifies that an older uncollected response cannot replace the
returned data and that no extra history GET is issued. Queue/worker coverage exercises stable
type-specific coalescing, no planner delay, current-revision fencing, bounded waiting and
cooldown/capacity deferral. Validation and registered projections still precede protected ESI
or module data access; no private query-persistence policy changes are introduced.

Repeated saved demand still checks delivery through the host requester, so an earlier capacity
or cooldown deferral does not suppress a later wake-up. A stalled admission reports `waiting`,
not `queued`. Both regressions fail against the preceding implementation and pass after the
fix. Exact-type due selection honors source expiry and failure backoff; a failure with no retry
boundary remains suspended rather than inventing a fifteen-minute retry, without suspending
other types in the profile.

### Final verification and deployment (2026-09-30)

Logs below are under `/var/folders/y0/8p43tkrn7rz1f8jlttdq2c900000gn/T/opencode`.

| Check                                 | Result                                | Log                                                                                                                  |
| ------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| API coverage                          | PASS, 2,725 tests                     | `history-demand-merged-api-coverage.log`                                                                             |
| PostgreSQL integration                | PASS, 430 tests                       | `history-demand-merged-postgres.log`                                                                                 |
| Redis integration and coverage        | PASS, 63 tests                        | `history-demand-merged-redis.log`                                                                                    |
| Frontend                              | PASS, 999 ordinary and 331 Nuxt tests | `history-demand-merged-frontend.log`                                                                                 |
| Module suites and package conformance | PASS                                  | `history-demand-merged-modules.log`                                                                                  |
| Registry and type contracts           | PASS, 503 tests                       | `history-demand-merged-registry-tests.log`                                                                           |
| Browser E2E                           | PASS, 93 tests on full retry          | `history-demand-merged-e2e-full-retry.log`                                                                           |
| API and Nuxt typechecks               | PASS                                  | `history-demand-merged-api-types.log`, `history-demand-merged-nuxt-types.log`                                        |
| API, Nuxt and E2E builds              | PASS                                  | `history-demand-merged-api-build.log`, `history-demand-merged-root-build.log`, `history-demand-merged-e2e-build.log` |
| Lint and architecture checks          | PASS on recheck                       | `history-demand-merged-lint-retry.log`                                                                               |
| Formatting and Knip                   | PASS                                  | `history-demand-merged-format-check.log`, `history-demand-merged-knip.log`                                           |

The first browser run passed 92 cases and timed out locating the logout button in the existing
cross-tab logout-race case. That case passed in isolation, then all 93 passed on a full retry.
The first lint run encountered an intermediate warning in concurrently edited Market UI code;
the recheck passed without a history-side suppression.

With explicit approval, the local unreleased baseline was synchronized for only
`list-due-market-history-types`, `record-market-history-failure`,
`request-market-history-demand`, and `upsert-market-history`. Current schema and attestation
metadata were backed up to `market-schema-before-history-sync.sql` and
`market-metadata-before-history-sync.sql`. The transaction asserted unchanged row counts in
all 18 Market business tables, including 406,252 order rows and 11,523 daily-history rows.
Normal startup reconciliation passed; a post-deployment audit matched all 34 active routines.
API and worker were rebuilt and restarted and reported healthy.

Live probes against the deployed Forge profile:

| Probe                                   | Result                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Previously uncollected Isogen (`37`)    | HTTP 200 `ready`, 365 days, 325 ms                                      |
| Immediate cached repeat                 | HTTP 200 `ready`, same validation time, 14 ms                           |
| Two simultaneous Nocxium (`38`) demands | Both HTTP 200 `ready`, 365 days, same validation time, 297 and 300 ms   |
| Queue inspection                        | One completed exact-type job for each type; concurrent demand coalesced |
| Demand without trusted Origin           | HTTP 403 `INVALID_ORIGIN`, 5 ms                                         |
| Invalid history type ID                 | HTTP 400                                                                |

These are individual local measurements, not latency percentiles. Evidence is in
`history-demand-merged-live-probes.log`, `history-demand-merged-live-jobs.log`,
`history-demand-merged-routine-sync.log`, `history-demand-merged-routine-audit-after.log`,
and `history-demand-merged-compose-ps.log`. No authorization-policy conflict was identified.

## Conclusion

The reviewed paths preserve their authorization, query, source and cache classifications. Full runtime acceptance still requires the private structure-market probe listed above.
