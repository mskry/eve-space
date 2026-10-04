# Fetching compliance review

## Scope

Group 6 of `add-authorized-aggregate-inventory`, on baseline `35bf357129965cbf18751d290bc0b29f1a6c5fe7` with existing groups 1–5 and unrelated working-tree changes preserved. Governing instructions are the root/scoped API, platform, Nuxt and organization guides, fetching checklist and change specifications. The root affected-scope verification policy takes precedence over the checklist's older repository-wide command list.

## Request inventory

| Consumer                                           | Result-changing inputs                                                                 | Trigger / SSR-capable?                                     | Final route                       | Mounted authorization                                                                                          | Resource                                                           | Persistence |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------- |
| `usePlatformInventoryQuery.ts`                     | Owner, scope, selected characters/corporation, full fingerprint                        | Client mount, focus, reconnect, revisions, renewal; no SSR | POST `/api/inventory/admission`   | Session middleware, module enablement, core admission and live release guard                                   | Authority metadata only                                            | None        |
| `usePlatformInventoryCorporations.ts`              | Owner, organization version, reviewer permissions and provider/section enablement      | Client mount, focus, reconnect, revisions, renewal; no SSR | GET `/api/inventory/corporations` | Session, generated exact reviewer declaration, current organization snapshot and live session/reviewer recheck | At most 250 current managed corporation IDs; no asset evidence     | None        |
| Personal operations in `useTradingInventory.ts`    | Character selection, applicable filters, group key, cursor, full authority/source view | Admitted client execution or buttons; no SSR               | POST `/graphql`                   | Personal aggregate strategy, exact owned subjects and release checks                                           | Existing personal inventory capability and registered asset source | None        |
| Corporation operations in `useTradingInventory.ts` | Corporation, applicable filters, group key, cursor, full authority/source view         | Admitted client execution or buttons; no SSR               | POST `/graphql`                   | Reviewer corporation strategy, Trading/Member Audit permissions, current organization and evidence subjects    | Existing Member Audit inventory provider                           | None        |

Metadata routes are chained into `api/src/index.ts` with private no-store middleware. Six generated GraphQL operations cover groups, holders and coverage for the two scopes. GraphQL field denials become `ApiQueryError` values through the established platform transport. Metadata does not replace admission of each GraphQL read.

## Results

| Check ID                                       | Result                              | Implementation evidence                                                                                                                                  | Behavioral evidence / reason                                                                                                                           |
| ---------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MOD-01, MOD-03, MOD-05, MOD-06                 | PASS                                | Feature owns generated DTO queries; platform owns admission/cancellation/lifecycle; host identity uses public query-persistence runtime                  | Platform, organization, HTTP and Nuxt boundaries; production browser build                                                                             |
| AUTH-01–AUTH-07                                | PASS within current reviewer policy | Mounted session/core admission, client-mount gates, no-store responses and independent server release checks                                             | API metadata tests; SSR, delayed scope switch and reviewer/session denial journeys                                                                     |
| QUERY-01–QUERY-05                              | PASS                                | Scope/filter resets, bounded local cursors, generated operations, field errors retaining status/code                                                     | Contract drift/type checks; source restart and delayed switch journeys                                                                                 |
| QUERY-06                                       | N/A                                 | No mutations                                                                                                                                             | Read-only inventory                                                                                                                                    |
| TIME-04, TIME-06, TIME-07                      | PASS                                | Explicit UTC server clocks; platform renews admission every 45 seconds, expires within 60 seconds and hides during verification                          | Holder-clock journey; unavailable-verdict and expiry lifecycle tests                                                                                   |
| PERSIST-01, PERSIST-04–PERSIST-07, PERSIST-10  | PASS for memory-only inventory      | No Colada inventory entry/storage adapter; owner/scope/revision invalidation; unknown verdict hides retained memory; known denial clears                 | IndexedDB scan includes persisted public positive control and excludes inventory contents; changed-fingerprint, owner-mismatch and late-response tests |
| PERSIST-02, PERSIST-03, PERSIST-08, PERSIST-09 | N/A for inventory storage           | Inventory never serializes or restores storage. Live host identity and focus/reconnect renewal gate local memory; existing persister mechanics unchanged | Persistence positive-control journey                                                                                                                   |
| ESI-08, ESI-10                                 | PASS for browser continuation       | Bounded pages replace results; mismatched full source views require restart; limits/gaps/denial remain distinct                                          | Restart and coverage/limit journeys                                                                                                                    |
| MOD-02, MOD-04, other TIME/ESI checks          | N/A for new upstream behavior       | No new ESI operation, transport, retry, source clock, cache or coordination implementation                                                               | Existing source owners and group 7 retain runtime acceptance                                                                                           |

## Findings

No unresolved fetching defect found within the implemented group 6 scope.

## Policy conflicts and missing evidence

- Task 2.2's policy was resolved on 2026-10-03: reviewer roles and permissions apply organization-wide across every current managed corporation, including an alliance's member corporations. Each request still selects one corporation. The spec now matches this policy; see `docs/trading-inventory-admission.md`.
- Capacity, Compose probes, target-deployment migration/rollback and EVE-16 corporation release acceptance remain group 7 work. Browser fixtures prove presentation/lifecycle behavior, not deployment authorization or capacity.

## Verification

All commands used Corepack-managed pnpm. Logs are local session evidence.

| Exact command                                                                                             | Result                         | Log                                                                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| `pnpm --filter @eve-space/api test tests/graphql-inventory.test.ts`                                       | 33 passed                      | `/tmp/eve-trading-6-api-tests.log`                                             |
| `pnpm --filter @eve-space/api test:postgres tests/integration/postgres/inventory-admission.test.ts`       | 6 passed; ephemeral PostgreSQL | `/tmp/eve-trading-6-postgres-tests.log`                                        |
| `pnpm --filter @eve-space/platform-module-nuxt test test/inventory-query.test.ts`                         | 10 passed                      | `/tmp/eve-trading-6-lifecycle-tests.log`                                       |
| `pnpm exec vitest run --config vitest.config.ts tests/platform/platform-host-identity.test.ts`            | 1 passed                       | `/tmp/eve-trading-6-host-identity.log`                                         |
| `pnpm test:e2e:build` then `pnpm test:e2e:built features/trading/nuxt/test/trading-inventory.e2e.test.ts` | Build and 5 journeys passed    | `/tmp/eve-trading-6-browser-build.log`, `/tmp/eve-trading-6-browser-tests.log` |
| `pnpm exec nuxt typecheck`                                                                                | Passed                         | `/tmp/eve-trading-6-nuxt-types.log`                                            |
| `pnpm --filter @eve-space/trading-nuxt typecheck:runtime`                                                 | Passed                         | `/tmp/eve-trading-6-runtime-types.log`                                         |
| `pnpm --filter @eve-space/api typecheck:local`                                                            | Passed                         | `/tmp/eve-trading-6-api-types.log`                                             |
| `pnpm registry:check`, `pnpm graphql:check`                                                               | Passed                         | `/tmp/eve-trading-6-registry.log`, `/tmp/eve-trading-6-graphql.log`            |
| `pnpm exec tsx scripts/verify-platform-boundaries.ts`                                                     | Passed                         | `/tmp/eve-trading-6-platform-boundaries.log`                                   |
| `pnpm exec tsx scripts/verify-organization-boundaries.ts`                                                 | Passed                         | `/tmp/eve-trading-6-organization-boundaries.log`                               |
| `pnpm exec tsx scripts/verify-nuxt-module-boundaries.ts`                                                  | Passed                         | `/tmp/eve-trading-6-nuxt-boundaries.log`                                       |
| `pnpm exec tsx scripts/verify-api-http-boundaries.ts`                                                     | Passed                         | `/tmp/eve-trading-6-http-boundaries.log`                                       |

Generation/build completed before consuming tests. Hooks and CI retain their broader matrix; no Compose or Redis acceptance is inferred.

## Conclusion

After the organization-wide policy confirmation, `pnpm --filter @eve-space/api test tests/organization/inventory-admission.test.ts tests/organization/module-authorization.test.ts` passed 28 tests (`/tmp/eve-trading-22-unit.log`). `pnpm --filter @eve-space/api test:postgres tests/integration/postgres/inventory-admission.test.ts` passed seven tests, including independent current alliance corporation selection and departure refusal (`/tmp/eve-trading-22-postgres.log`).

Compliant within the implemented presentation scope and confirmed organization-wide reviewer policy. Deployment acceptance remains open; no whole-codebase compliance claim.
