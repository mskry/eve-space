# Gateway contract correction verification

## Scope

- Date: 2026-10-03. Base commit: `35bf357129965cbf18751d290bc0b29f1a6c5fe7`, plus this change.
- Corrects assessment findings F1–F5: post-dispatch mutation cancellation, disposable repair-state loss, cache-lease renewal drain, execution-path guidance and ordinary egress-check bypasses.
- Governing instructions: root and gateway `AGENTS.md`, [fetching-layer compliance checklist](fetching-layer-compliance-checklist.md), and [invalidation and recovery contract](esi-gateway-invalidation.md).
- Gateway interfaces, SDK ownership, authorization, core canonical mapping and the platform wire-cache exception retain their existing owners. No SDK upgrade or browser request change.

## Request inventory

| Consumer                             | Identity                                                                            | Trigger / SSR                 | Final route / authority                                                                                                     | Resource                                                  | Persistence                 |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------- |
| Registered mailbox mutations         | Character, lifecycle, mailbox principal, mutation inputs                            | Existing server mutation path | Mail routes mounted under `/api/me/characters` in `api/src/index.ts`; validated path/body, session and `loadOwnedCharacter` | Registered character mutation with durable mailbox intent | No new browser persistence  |
| Registered mail reads                | Character, lifecycle, authorization generation, representation and mailbox revision | Existing server read path     | Same mount and owned-character admission                                                                                    | Registered read; uncached while intent remains            | Existing policies unchanged |
| Shared registered and platform reads | Representation, operation and applicable subject/generation/revision                | Existing server execution     | Existing caller-owned resource admission                                                                                    | Same gateway runtime and scoped SDK attempt               | Existing policies unchanged |

These rows delimit the gateway change. They do not certify every route, SSR consumer or organization admission path.

## Results

| Check IDs                              | Result                                 | Implementation evidence                                                                                                             | Behavioral evidence                                                                                                                                          |
| -------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MOD-01–04                              | PASS within gateway scope              | Public seams and mapping ownership remain intact; shared operations select one path per invocation; version ownership is documented | Gateway interface, identity, secrecy and structural tests                                                                                                    |
| QUERY-06                               | PASS within gateway scope              | Durable intent before dispatch; finalization independent of later caller cancellation                                               | Cancellation/failure and two-runtime cache-loss regressions in `execution-runtime-behavior.test.ts`                                                          |
| ESI-03–04                              | PASS for tested consistency boundaries | Atomic intent/revision reads, token-specific idempotent completion; unresolved intent bypasses all caches                           | Real Redis tests preserve gating after Cache Redis loss, cover concurrent intents, idempotent completion and a warmed runtime using another Redis connection |
| ESI-05                                 | PASS for tested shutdown contract      | Cache-lease renewal serialization and join precede release; upstream permit lifecycle retained                                      | `runtime-lifecycle.test.ts` holds renewal pending through successful body completion and runtime close, then resolves/rejects it                             |
| ESI-06–07, ESI-10                      | PASS for covered gateway behavior      | Existing retry and quota policy; mutation outcome survives cancellation; durable intent contains no secrets                         | Existing failure/secrecy tests, retained retry-count and successful-after-abort tests                                                                        |
| AUTH-04                                | PASS for unchanged sampled mounts      | Wallet and mail still validate inputs and load session/owned character before gateway access                                        | Isolated API rejects unauthenticated wallet/mail access; invalid wallet path returns 400                                                                     |
| Browser AUTH/QUERY/TIME/PERSIST checks | N/A                                    | No browser requests, SSR behavior or persistence policy changed                                                                     | Outside this correction's scope                                                                                                                              |

## Findings resolved

- F1: mutation settlement omits the caller signal after the pre-dispatch checks. Its invalidation finalizer runs before the authorization callback returns, even when the SDK rejects or the caller has aborted.
- F2: coordination Redis owns intent before dispatch. Registration failure prevents egress. A lost disposable marker can no longer make another runtime's pre-mutation cache eligible. Completion advances the revision and clears the intent atomically; replaying a token is idempotent.
- F3: one issued lease renewal is retained and joined before release. Stopping its timer cannot make runtime close outrun a pending Redis command.
- F4: guidance now permits the verifier's reviewed shared operations to retain distinct core and platform representations, with one selected path per invocation. Factory/schema version changes remain owned by the operation catalog.
- F5: fixtures reject local URL constants, concatenations and ordinary global fetch aliases in core and installed feature code. The documented verifier scope remains bounded.

Two removed anti-slop findings and one removed complexity baseline entry reflect deleted code and a split test adapter; no new finding was baselined. Gateway tests are grouped so newly changed callbacks remain within the complexity limit.

## Policy conflicts and missing evidence

- Orphaned intents intentionally suspend cache reuse until quiescent recovery. They never expire automatically. Cache identity v4 rejects values produced under the former contract. Deployment and rollback require all old runtimes drained; see the [operator contract](esi-gateway-invalidation.md).
- The first full API coverage run had an unexpected test-worker exit: 237 files and 2,948 tests completed. The rerun with one worker passed all 238 files and 2,960 tests, including every coverage threshold.
- GitNexus impact queries identified the runtime constructor/composition and execution seams. Change analysis reported broad/critical impact, including stale symbols and spurious same-name cache-helper paths. It supplements exact-source verification and tests; it is not a complete or clean graph certification. The codebase-memory coverage tool was unavailable. A post-commit index refresh also failed with `ERR_PNPM_IGNORED_BUILDS` for additional GitNexus dependency build scripts.
- Cached-quota specification reconciliation and the organization's SDK review provenance remain the assessment's separate follow-ups. No live ESI mutation, EVE account, crash/restart durability experiment or production rollout was exercised.

## Verification

Runner logs are local artifacts under `.quality-logs/esi-gateway-contracts/` and are intentionally untracked.

| Exact command / check                                                                                                                                                 | Result                                                  | Local log                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| `pnpm --filter @eve-space/api test tests/esi-gateway`                                                                                                                 | Exit 0; 31 files, 371 tests                             | `gateway.log`                             |
| `pnpm exec node scripts/verify-esi-egress.mjs`                                                                                                                        | Exit 0                                                  | `egress.log`                              |
| `pnpm exec tsx scripts/verify-esi-gateway-boundaries.ts`                                                                                                              | Exit 0                                                  | `boundaries.log`                          |
| `pnpm knip`                                                                                                                                                           | Exit 0; unused cache-port export removed                | `knip.log`                                |
| `pnpm lint`                                                                                                                                                           | Exit 0, including structural and quality checks         | `lint.log`                                |
| `pnpm format:check`                                                                                                                                                   | Exit 0                                                  | `format.log`                              |
| `pnpm --filter @eve-space/api typecheck`                                                                                                                              | Exit 0                                                  | `typecheck.log`                           |
| `pnpm --filter @eve-space/api test:coverage --maxWorkers=1`                                                                                                           | Exit 0; 238 files, 2,960 tests; coverage thresholds met | `api-coverage-retry.log`                  |
| `pnpm --filter @eve-space/api test:redis`                                                                                                                             | Exit 0; 4 files, 68 tests; coverage thresholds met      | `redis.log`                               |
| `pnpm --filter @eve-space/api test:postgres`                                                                                                                          | Exit 0; 27 files, 443 tests                             | `postgres.log`                            |
| `pnpm --filter @eve-space/api build`                                                                                                                                  | Exit 0                                                  | `api-build.log`                           |
| `pnpm build`                                                                                                                                                          | Exit 0                                                  | `nuxt-build.log`                          |
| `pnpm --filter @eve-space/api exec vitest run --config vitest.redis.config.ts tests/integration/redis/esi-gateway.test.ts`                                            | Exit 0; final scoped run, 48 tests                      | `gateway-redis-final.log`                 |
| Isolated `docker compose --env-file <temporary-env> -p eve-gateway-contracts-7359 -f compose.yml -f <temporary-override> up -d --build --wait --wait-timeout 120 api` | Exit 0; API and dependencies healthy                    | `compose-build.log`, `compose-status.log` |
| Isolated Compose project cleanup                                                                                                                                      | Exit 0; only new disposable test storage removed        | `compose-cleanup.log`                     |

API probes used a separate port and disposable PostgreSQL/coordination storage; the existing development stack was preserved. No authenticated ESI request was made.

| Probe                                                     | Expected / actual |
| --------------------------------------------------------- | ----------------- |
| `GET /health`                                             | 200 / 200         |
| `GET /api/status`                                         | 200 / 200         |
| `GET /api/me/characters/7/wallet`                         | 401 / 401         |
| `GET /api/me/characters/invalid/wallet`                   | 400 / 400         |
| `DELETE /api/me/characters/7/mail/50` with trusted Origin | 401 / 401         |

## Conclusion

Compliant within the corrected gateway contracts and tested Redis semantics. Production rollout, live ESI behavior and unreviewed browser/organization admission paths are outside this verification.
