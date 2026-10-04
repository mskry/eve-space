# Market intelligence capacity and verification

## Scenario and boundaries

The opt-in `api/tests/integration/postgres/market-intelligence-capacity.test.ts` scenario
runs 10,646 regional types plus one separate Global PLEX type through the delivered
history resource, installed persistence capabilities and all ordered Market migrations.
Each source supplies 365 completed UTC dates: 3,886,155 daily rows. One synthetic regional
book supplies 10,646 sell orders. It uses PostgreSQL 17.11 and Node 24.20.0 in an ephemeral
Testcontainers database; fake ESI supplies deterministic public responses without live load.

The resource plans and executes repeated bounded passes, reconstructs its invokers halfway
through, checks each fresh canonical source is collected once, and publishes a complete
report using derivation with a zero ESI request budget. A refresh with identical daily values
changes zero content rows and does not rewrite their content timestamp. A one-cent correction
changes exactly one row. Other focused PostgreSQL tests prove continuations remain on the
prior generation during replacement and require restart after retirement or policy changes.

This scenario accelerates time: a fake provider models the minimum 1,000-ms history starts
and a virtual 30-second planner cadence. It records planned profile candidates rather than
actual BullMQ occupancy. Real Redis integration tests separately prove shared history start
spacing across runtimes/representations/retries, cache-hit reuse, longer cooldowns,
unavailable-coordination deferral, and durable worker scheduling/coalescing/high-water gates.
The accelerated scenario cannot establish live ESI latency or scheduler contention.
Generation-start spacing still uses the database clock; the final publication step advances
that test floor explicitly. The daily estimate below reserves interleaved work conservatively
rather than pretending the virtual clock ran PostgreSQL or BullMQ timers.

## Measured results

The last completed measurement is recorded below; raw local JSON and full EXPLAIN trees
are retained in `/tmp/market-intelligence-capacity.json` and the runner log in
`/tmp/market-intelligence-capacity.log`.

Run recorded on 2026-10-04:

| Measurement                                             | Result                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Wall time for sweep, publication and measurements       | 226.433 seconds                                                        |
| Regional / separate Global PLEX sources                 | 10,646 / 1                                                             |
| Supplied daily history rows                             | 3,886,155                                                              |
| Upstream fake responses / dedicated planner passes      | 10,647 / 672                                                           |
| Maximum planned profile candidates                      | 2 (configured bound 4; no per-type jobs)                               |
| Modeled drain at 30-second cadence                      | 5.60 hours                                                             |
| Conservative drain reserving interleaved local work     | 16.66 hours                                                            |
| Restart / identical refresh / one-cent correction       | Resumed successfully / zero changed daily rows / one changed daily row |
| Executed three-panel GraphQL latency / response payload | 99.710 ms / 6,296 bytes                                                |

| Extracted routine plan   | Planning / execution | Filtered types |
| ------------------------ | -------------------- | -------------- |
| `underpriceMonthPercent` | 0.284 / 47.178 ms    | 10,646         |
| `daysSupply10Percent`    | 0.307 / 32.736 ms    | 5,323          |
| `anchorVolumeSpike`      | 0.257 / 37.220 ms    | 10,646         |

Each plan uses a generation-keyed output index scan and a top-N sort returning 26 rows
(25 plus continuation evidence). Group matching and activity predicates run before totals
and ranking; the subgroup retains 5,323 of 10,646 output rows. There is no scan of daily
history or raw order tables during these reads. The materialized filtered report does spill
to temporary files at this fixture size: about 2,584 written 8-KiB blocks for the whole-group
and volume panels, and 1,285 for the subgroup, with repeated reads for totals/page selection.
These warm-cache, single-run local timings do not establish percentile latency under load.

| Stored relation                   | Heap bytes  | Index bytes |
| --------------------------------- | ----------- | ----------- |
| `market_daily_history`            | 361,766,912 | 263,217,152 |
| `market_history_sources`          | 1,835,008   | 352,256     |
| `market_intelligence_generations` | 8,192       | 49,152      |
| `market_intelligence_inputs`      | 31,981,568  | 1,032,192   |
| `market_intelligence_outputs`     | 39,256,064  | 2,768,896   |

The minimum-start lower bound for 10,647 distinct upstream requests is about 2.96 hours.
At 16 requests per profile job and a 30-second planner cadence, a history-only sweep is
about 5.55 hours before latency/cooldowns. Conservatively reserving two of every three passes
for reconciliation/derivation gives 16.66 hours, leaving about 7.34 hours in a daily window.
This is a scheduling calculation, not a promise: the rollout gate requires actual daily
cycles to fit source expiry under other worker work and upstream cooldowns.

The three-panel operation selects month underpricing for a group and its descendants,
10-percent depth supply for a subgroup, and anchor volume spike for all eligible types.
Each panel requests 25 rows under the default activity thresholds. Admission reserves
4,508 of 5,000 weighted cost units and 300 of 1,000 projected list rows; list accounting
uses declared maxima. It does not equate cost units to literal SQL rows. The runtime retains
its 32-backend-call, four-concurrent-call, 2-MiB memo and 15-second deadline limits.

For plan measurement the harness extracts the actual installed page routine body, binds
JSON through the driver's JSON parameter helper, and runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT
JSON)` under the routine migration/owner role in a read-only transaction. It rejects an empty plan
that does not access report outputs. An earlier harness encoded a JSON string twice and
produced constant-false plans; those plan figures are superseded and are not used as evidence.
The runtime role intentionally has routine execution without direct table/view reads; extracting
a security-definer routine body requires its owner role. Setup checks that measurement context
and JSON parameter shape before the expensive sweep.

Storage figures are heap and indexes for these tables at the end of one synthetic sweep.
They omit TOAST, WAL, vacuum overhead, backups and unrelated books. Frozen inputs/outputs
include the generations retained during this run; data shape, observed days, prior-generation
retention and long-lived write churn will change production storage. They are measurements
of the fixture, not a linear production reservation or a worst-case 32,000-type bound.

## Focused verification

Commands below use the Corepack-managed pnpm version. Shared registry/schema/operation
artifacts were generated before dependent checks. Scope follows `docs/agent-verification.md`;
commit/push hooks and CI retain their broader matrix.

| Command                                                                                                                                                                                                                                          | Result                                                                                            | Local evidence                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm graphql:generate`, then `pnpm graphql:check`                                                                                                                                                                                               | PASS; composed schema/inventories and curated Market/Trading types agree                          | `/tmp/market-intelligence-graphql-check.log`                                                   |
| `pnpm --filter @eve-space/market-server build`                                                                                                                                                                                                   | PASS                                                                                              | `/tmp/market-intelligence-build.log`                                                           |
| `pnpm --filter @eve-space/api typecheck:local`                                                                                                                                                                                                   | PASS; affected installed server packages plus API/source/test types                               | `/tmp/market-intelligence-api-typecheck.log`                                                   |
| `pnpm --filter @eve-space/market-server test`                                                                                                                                                                                                    | PASS; 114 tests                                                                                   | `/tmp/market-intelligence-feature-tests.log`                                                   |
| Targeted API command below                                                                                                                                                                                                                       | PASS; all 171 affected tests across the initial run and the corrected endpoint/profile-work rerun | `/tmp/market-intelligence-final-api-tests.log`, `/tmp/market-intelligence-final-api-fixes.log` |
| `pnpm --filter @eve-space/api test:postgres tests/integration/postgres/market-intelligence-generations.test.ts tests/integration/postgres/market-intelligence-persistence.test.ts tests/integration/postgres/market-profile-persistence.test.ts` | PASS; 41 tests                                                                                    | `/tmp/market-intelligence-final-postgres.log`                                                  |
| `MARKET_INTELLIGENCE_CAPACITY=1 pnpm --filter @eve-space/api test:postgres tests/integration/postgres/market-intelligence-capacity.test.ts`                                                                                                      | PASS; two tests including the full capacity scenario                                              | `/tmp/market-intelligence-capacity.log`, `/tmp/market-intelligence-capacity.json`              |
| `pnpm --filter @eve-space/api test:redis:no-coverage tests/integration/redis/esi-gateway.test.ts`                                                                                                                                                | PASS; 51 tests                                                                                    | `/tmp/market-intelligence-gateway-redis-all.log`                                               |
| `pnpm --filter @eve-space/api test:redis:no-coverage tests/integration/redis/worker-platform.test.ts -t 'profile                                                                                                                                 | register                                                                                          | planner coalescing                                                                             | cooldown'` | PASS; four affected tests | `/tmp/market-intelligence-final-worker-redis.log` |
| `pnpm exec vitest run --config vitest.registry.config.ts tests/platform/graphql-contributions.test.ts tests/platform/platform-module-conformance.test.ts tests/platform/platform-module-registry.test.ts`                                        | PASS; 229 tests                                                                                   | `/tmp/market-intelligence-registry-tests.log`                                                  |
| GraphQL documentation fence validation against `api/src/generated/graphql/application.graphql`, followed by host aggregate admission with representative variables                                                                               | PASS; example cost 4,275 and 465 projected rows                                                   | `/tmp/market-intelligence-doc-graphql.log`                                                     |
| Individual boundary commands below                                                                                                                                                                                                               | PASS; exact memberships/import directions and gateway egress                                      | `/tmp/market-intelligence-*-boundaries.log`, `/tmp/market-intelligence-esi-egress.log`         |

The targeted API command was:

```bash
pnpm --filter @eve-space/api test tests/graphql-market.test.ts tests/graphql-contributions.test.ts tests/graphql-schema-artifact.test.ts tests/graphql-inventory.test.ts tests/graphql-execution-policy.test.ts tests/graphql-endpoint.test.ts tests/platform/profile-work.test.ts tests/platform/market-history-route.test.ts tests/core-data/capabilities.test.ts tests/core-data/product-catalog.test.ts tests/queue/job-contracts.test.ts tests/queue/planner.test.ts tests/queue/profile-work-planner.test.ts tests/queue/scheduler.test.ts
pnpm --filter @eve-space/api test tests/graphql-endpoint.test.ts tests/platform/profile-work.test.ts
```

The individual boundary commands were:

```bash
pnpm exec tsx scripts/verify-market-server-boundaries.ts
pnpm exec tsx scripts/verify-esi-gateway-boundaries.ts
pnpm exec tsx scripts/verify-queue-boundaries.ts
pnpm exec tsx scripts/verify-platform-boundaries.ts
pnpm exec tsx scripts/verify-graphql-boundaries.ts
pnpm exec tsx scripts/verify-core-data-boundaries.ts
pnpm exec tsx scripts/verify-platform-module-contract-boundaries.ts
pnpm exec node scripts/verify-esi-egress.mjs
```

Additional affected consumer checks passed: `pnpm --filter @eve-space/core-data-contract test
test/contract.test.ts` (five tests), and `pnpm --filter @eve-space/market-nuxt test
test/market-graphql-adapters.test.ts` (seven tests). The PostgreSQL generation suite was rerun
after its test adapter moved to the package contribution interface (three tests passed).
Logs are `/tmp/market-intelligence-core-data-contract-tests.log`,
`/tmp/market-intelligence-nuxt-contract-tests.log` and
`/tmp/market-intelligence-final-generations.log`.

Affected-file `oxfmt --check`, `oxlint` and `git diff --check` passed. Logs are
`/tmp/market-intelligence-format-check.log` and `/tmp/market-intelligence-oxlint.log`. No production
policy was enabled, live ESI requests issued, deployment containers rebuilt or persistent
volumes reset. See [deployment acceptance and rollback](market-intelligence-delivery.md)
and [the scoped fetching review](market-intelligence-fetching-review.md).
