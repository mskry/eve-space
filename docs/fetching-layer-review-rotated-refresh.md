# Fetching compliance review: rotated EVE refresh tokens

## Scope

- Commit: current working tree for `preserve-rotated-refresh-tokens` (uncommitted).
- Paths: character gateway authorization, browser session bootstrap, live cache-admission renewal,
  protected-query invalidation, and retained private cache. Governed by root and scoped auth,
  gateway, and query-persistence engineering guides and the change's two spec deltas.

## Request inventory

| Consumer / definition                                      | Identity and trigger                                                      | Final route and authorization                                                                                                                     | Upstream and persistence                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/queries/auth.ts` `loadAuthBootstrap`                  | Client-side session initialization; no SSR request                        | `GET /auth/session?includeAdmission=true`, mounted in `api/src/index.ts` under `/auth`; cookie read and `findSession` in `api/src/auth/routes.ts` | PostgreSQL admission; session excluded from query persistence                                                                                                 |
| `app/queries/auth.ts` `loadCacheAdmission`                 | Client-side renewal, focus, retry, manual refresh                         | `GET /api/me/cache-admission`, mounted under `/api/me/cache-admission`; `loadSession` and `requireSession` in `api/src/cache-admission/routes.ts` | PostgreSQL admission, optional auth-owned SSO recovery; admission DTO excluded from persistence                                                               |
| `app/queries/query-cache.ts` `refreshPrivateAuthorization` | Browser character-removal and authorization refresh events                | Same live admission route; known character removal also invalidates its character scope immediately                                               | Retained character and organization DTOs remain separately bound and gated                                                                                    |
| Registered character gateway representation                | Owned-character or platform-authorized character read, before L1/L2 cache | Final mounted character route requires `owned-character` middleware, or platform binding guard before gateway execution                           | `getCharacterCacheAuthorizationForLifecycle` checks pending before cache, then uses generation-bound Redis envelopes; pending credentials are PostgreSQL-only |

## Results

| Check IDs             | Result                                                                                                                     | Evidence                                                                                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MOD-01–06, AUTH-01–07 | PASS (reviewed paths)                                                                                                      | `api/src/auth/tokens.ts`, `api/src/cache-admission/service.ts`, `app/queries/auth.ts`, `app/composables/useCharacterOwnership.ts`, `app/query-persistence/runtime.ts`; gateway Redis and browser tests exercise pre-cache authorization, pending query gating, and client-only session initialization. |
| QUERY-01–06           | PASS (reviewed paths)                                                                                                      | Admission remains inferred through chained Hono routes and `AppType`; per-character pending variant carries no revision or token material; `app/query-persistence/envelope.ts` rejects malformed variants and only matches verified revisions.                                                         |
| TIME-01–07            | PASS for changed authorization and admission timing; N/A for unchanged ESI validator/response and query-residency policy   | `api/tests/integration/redis/pending-token-gateway.test.ts` proves pending blocks fresh L1/L2 hits; `tests/queries/query-persistence-runtime.test.ts` exercises admission deadlines and retained snapshot age. No ESI operation contract or HTTP freshness policy changed.                             |
| PERSIST-01–10         | PASS (reviewed paths)                                                                                                      | Pending snapshots remain quarantined, other scopes stay admitted, and same/changed revision recovery is covered in `tests/queries/query-persistence-runtime.test.ts`; session bootstrap and admission recovery are covered by `tests/queries/private-query-lifecycle.test.ts`.                         |
| ESI-01–10             | PASS for unchanged gateway execution contracts and changed pre-cache authorization; N/A for pagination and name resolution | No new ESI operation or wire schema; `api/tests/integration/redis/pending-token-gateway.test.ts` exercises the real representation, Redis generation fence, and no upstream read on pending outage.                                                                                                    |

## Policy conflicts and missing evidence

- No policy expansion is required: protected browser requests remain client-only, and pending tokens
  never enter client DTOs or Redis. The local Compose database contained no pending rows; the user
  accepted isolated real-PostgreSQL/Redis process and gateway tests for the pending-to-recovered
  outcome instead of a live-SSO Compose fixture.

## Verification

| Exact command / probe                                                                                                                                                 | Result              | Evidence                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @eve-space/api exec vitest run --config vitest.redis.config.ts tests/integration/redis/pending-token-gateway.test.ts`                                  | PASS                | Real cache-hit recovery with PostgreSQL and two Redis containers                                                                             |
| `pnpm --filter @eve-space/api exec vitest run --config vitest.postgres.config.ts tests/integration/postgres/pending-token-recovery.test.ts`                           | PASS                | Recovery after process restart, admission retry and isolation                                                                                |
| `pnpm --filter @eve-space/api exec vitest run tests/auth/routes.test.ts tests/cache-admission/routes.test.ts tests/cache-admission/service.test.ts`                   | PASS                | Typed mounted routes and partial admission                                                                                                   |
| `pnpm exec vitest run tests/queries/private-query-lifecycle.test.ts tests/queries/query-persistence-runtime.test.ts tests/queries/query-persistence-envelope.test.ts` | PASS                | Browser bootstrap, suspension, renewal, and retained snapshots                                                                               |
| `docker compose up -d --build api`, then `docker compose up -d --build worker`                                                                                        | PASS                | Worker health command and core migration `015` readiness verified after rebuild                                                              |
| `GET /health`, malformed and unauthenticated wallet character routes                                                                                                  | `200`, `400`, `401` | Live rebuilt Compose API; no authenticated pending row was available                                                                         |
| Post-rebuild pending PostgreSQL and Redis integration tests                                                                                                           | PASS                | Isolated pending outage, process restart, gateway cache-hit recovery; ciphertext and fake tokens absent from Redis and domain-event payloads |
| Post-rebuild API/worker log credential-field marker scan                                                                                                              | PASS                | No `access_token`, `refresh_token`, `encrypted_tokens`, or bearer-header markers in captured service logs                                    |

## Conclusion

The reviewed request and cache paths preserve the server authorization boundary and quarantine a
pending character without discarding its retained browser partition. Live Compose health and route
status checks and isolated pending/recovery integration tests passed; an authenticated live-SSO
pending transition was not exercised against the Compose database.
