# Reviewer character landing verification

## Scope and state

OpenSpec change `add-reviewer-character-directory-and-read-only-landing` on branch
`fix/eve-16-reviewer-evidence-seam`, base commit `9a8275e4`, with uncommitted implementation
changes. The official ESI snapshot resolves to compatibility date `2026-08-18`. The current
observation section and module are both disabled in the local Compose database (`f|f|0|0` for
module enabled, section enabled, disclosure version, activation version). No current-ship or
current-location collection-state rows or retained snapshots were present after rebuild (`0|0`).

## Verification

Each command below exited successfully after dependent artifacts were generated in order. Logs
were written outside the repository in
`/var/folders/y0/8p43tkrn7rz1f8jlttdq2c900000gn/T/opencode/`.

| Exact command                                                                                                                                   | Result                                                                                                | Log basename                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm registry:generate`                                                                                                                        | PASS; 14 generated registries checked subsequently                                                    | `reviewer-registry-generate.log`                                 |
| `pnpm core-data:coverage:generate`                                                                                                              | PASS                                                                                                  | `reviewer-coverage-generate.log`                                 |
| `pnpm typecheck`                                                                                                                                | PASS, API and Nuxt                                                                                    | `reviewer-final-typecheck.log`                                   |
| `pnpm --filter @eve-space/api typecheck`                                                                                                        | PASS, including dependency build                                                                      | `reviewer-api-typecheck-full.log`                                |
| `pnpm lint`                                                                                                                                     | PASS, including registry, boundaries and quality baselines                                            | `reviewer-lint.log`                                              |
| `pnpm format:check`                                                                                                                             | PASS                                                                                                  | `reviewer-format-check.log`                                      |
| `pnpm test:registry`                                                                                                                            | PASS                                                                                                  | `reviewer-registry-tests.log`                                    |
| `pnpm test:modules`                                                                                                                             | PASS, including standalone Nuxt fixture and source/package conformance                                | `reviewer-modules-tests.log`                                     |
| `pnpm test:packaging`                                                                                                                           | PASS, including API/Nuxt build and external panel packaging                                           | `reviewer-packaging.log`                                         |
| `pnpm --filter @eve-space/api test:coverage`                                                                                                    | PASS, 211 files and 2,640 tests                                                                       | `reviewer-api-coverage.log`                                      |
| `pnpm --filter @eve-space/api test:redis`                                                                                                       | PASS with Testcontainers                                                                              | `reviewer-redis-tests.log`                                       |
| `pnpm --filter @eve-space/api test:postgres`                                                                                                    | PASS, 24 files and 392 tests with Testcontainers                                                      | `reviewer-postgres-tests.log`                                    |
| `pnpm test:frontend`                                                                                                                            | PASS, unit and mounted Nuxt suites                                                                    | `reviewer-frontend-tests.log`                                    |
| `pnpm --filter @eve-space/api build`                                                                                                            | PASS                                                                                                  | `reviewer-api-build.log`                                         |
| `pnpm test:e2e:build && pnpm exec vitest run --config vitest.e2e.config.ts tests/organization/member-audit-review.e2e.test.ts`                  | PASS, four production-server browser journeys                                                         | `reviewer-e2e-build.log`, `reviewer-e2e-tests.log`               |
| `pnpm esi:validate`                                                                                                                             | PASS, including generated-source reproducibility, SDK tests, docs, examples, types and package checks | `reviewer-esi-validate.log`                                      |
| `pnpm --filter @eve-space/api exec vitest run tests/platform/module-settings.test.ts`                                                           | PASS, raw PostgreSQL timestamp regression                                                             | `reviewer-module-settings-targeted.log`                          |
| `pnpm --filter @eve-space/api exec vitest run --config vitest.postgres.config.ts tests/integration/postgres/local-organization-fixture.test.ts` | PASS, guarded seed and real admin login                                                               | `reviewer-fixture-postgres-test.log`                             |
| `pnpm --filter @eve-space/api test:coverage` after fixture corrections                                                                          | PASS                                                                                                  | `reviewer-fixture-api-coverage.log`                              |
| `pnpm --filter @eve-space/api typecheck:local` after fixture corrections                                                                        | PASS                                                                                                  | `reviewer-fixture-typecheck.log`                                 |
| `pnpm lint` and `pnpm format:check` after fixture corrections                                                                                   | PASS                                                                                                  | `reviewer-fixture-lint.log`, `reviewer-fixture-format-check.log` |
| `docker compose up -d --build api worker` after fixture corrections                                                                             | PASS; both processes healthy and `/api/status` returned 200                                           | `reviewer-fixture-compose-rebuild.log`                           |
| `git diff --check`                                                                                                                              | PASS                                                                                                  | Terminal output (empty)                                          |

The core schema snapshot was reviewed and regenerated for the forward-only OAuth lifecycle,
resource expiry, and sensitive-audit migrations. The installed persistence fingerprint test now
asserts the generated fingerprint for the new Member Audit migration. Quality baselines were
refreshed only after removing new anti-slop findings and refactoring isolated new complexity;
the remaining changed fingerprints describe existing long test containers and workspace setup.

## Local runtime probes

`docker compose up -d --build api worker` succeeded. `docker compose ps` reported API, worker,
PostgreSQL, Cache Redis, and Queue Redis healthy. Requests to `localhost:8788` returned:

| Method and route                                                                                     | Actual | Meaning                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `GET /api/status`                                                                                    | 200    | Public status is available.                                                                    |
| `GET /api/organization/review/characters?limit=25`                                                   | 401    | Session required; response has `Cache-Control: private, no-store` and `Vary: Cookie, Origin`.  |
| `GET /api/organization/review/characters?limit=51`                                                   | 401    | Authentication precedes query validation. Invalid-input 400 is covered by mounted route tests. |
| `GET /api/organization/review/members/not-a-uuid/characters/not-an-id`                               | 401    | Authentication precedes exact-target parameter validation.                                     |
| `GET /api/modules/member-audit/accounts/:userId/characters/:characterId/overview`                    | 404    | Disabled module route hidden.                                                                  |
| `GET /api/modules/member-audit/accounts/:userId/characters/:characterId/current-observation`         | 404    | Disabled sensitive section hidden.                                                             |
| `POST /api/modules/member-audit/accounts/:userId/block` with trusted `Origin` and JSON preconditions | 404    | Disabled action route hidden; no mutation.                                                     |
| `GET /api/me/characters/90000001`                                                                    | 401    | Owner route remains session-protected.                                                         |

An **isolated** database `eve_space_fixture_reviewer_20260927` was created for authenticated
runtime probes; the shared `eve_space` database was not modified. The one-shot local organization
fixture seeded a synthetic director, eight resources and a time-limited application session.
A separate development API listened on port 8789, with no worker pointed at the fixture.
The fixture's admin enabled only Member Audit `overview` and `access-management`; its owner
created a restricted manual bundle/group containing search, summary and block permissions and
assigned it through core routes. The fixture session bearer was exchanged through the
development-only form endpoint and the handoff file was deleted after use; no bearer was logged.

| Authenticated fixture method and route                                             | Actual                             | Evidence                                                                  |
| ---------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `GET /auth/session` and `POST /api/admin/login`                                    | 200 / 200                          | HttpOnly member/admin sessions established.                               |
| `PUT /api/admin/modules/member-audit` and enabled `overview` / `access-management` | 200 each                           | Deployment enablement stays separate from organization permission grants. |
| Owner bundle, group and assignment creation                                        | 201 each                           | Core authorization granted the fixture reviewer explicitly.               |
| `GET /api/organization/review`                                                     | 200                                | Three permitted contributions; version 1.                                 |
| `GET /api/organization/review/characters?limit=25`                                 | 200                                | One eligible character, private/no-store.                                 |
| `GET /api/organization/review/characters?limit=51`                                 | 400                                | Validated page limit.                                                     |
| `GET /api/organization/review/members/:userId/characters/90000001`                 | 200                                | Exact authorized target, private/no-store.                                |
| Same exact target with character `90000002`                                        | 404                                | Unowned character not substituted.                                        |
| `GET /api/modules/member-audit/accounts/:userId/block`                             | 200                                | Enabled account action state.                                             |
| `POST` to that block route with an old lifecycle confirmation                      | 409 `MEMBER_BLOCK_CONTEXT_CHANGED` | No mutation; expected version/lifecycle checked in core.                  |
| `GET .../characters/90000002/overview`                                             | 404 `REVIEW_TARGET_NOT_FOUND`      | Out-of-scope profile denied before ESI.                                   |
| `GET .../characters/90000001/current-observation`                                  | 404                                | Sensitive section remains disabled.                                       |
| `GET /api/me/characters/90000002`                                                  | 404 `CHARACTER_NOT_FOUND`          | Owner route still enforces ownership.                                     |

All fixture responses above were private/no-store. Exact output is in
`reviewer-fixture-probe.log` in the same temporary log directory. The fixture's observation
section remained disabled and had zero observation collection-state rows and snapshots (`t|f|0|0`
for module enabled, section enabled, collection rows, snapshots). A valid synthetic-character
public-profile fetch was deliberately not sent to ESI: fixture tokens/identities do not make
that upstream request valid. The enabled valid profile and observation response paths remain
covered by mounted Hono and production-server browser fixtures, rather than a live ESI call.

The live fixture exposed and led to two corrections: the fixture admin's `@localhost` email
failed the application email validator, and raw PostgreSQL timestamps reached module enablement
as strings. The fixture now uses a reserved valid test domain, and module-setting DTOs normalize
raw dates; a PostgreSQL fixture login and module-setting regression test cover them. The isolated
fixture database is retained for this review; it is not reused or reset for another seed. The
temporary fixture API is stopped after probing. The local shared API/worker rebuild did not
enable observation collection or grant its permission.

## Capacity gate

At the proposed 300-second cadence, two independent observations imply a conservative upper
bound of `eligible characters × 24` ship/location attempts per hour, or `× 576` per day, before
conditional hits, retries and enrichment. For 50 eligible characters this is 1,200 attempts/hour
(300 per 15 minutes). Successful 2xx calls cost two bucket tokens, so this alone would consume
600 tokens per 15 minutes, 50% of the reviewed shared `char-location` 1,200-token/15-minute
bucket. The actual response mix, owner traffic,
cache-hit rate, burst distribution, enrichment, retries and cooldowns must be measured, not
inferred from this planning arithmetic. The live ship cache and event-based location declaration
both give a five-second client cache; the proposed five-minute schedule does not itself ensure
current observations between validations. Each resource has a 24-hour absolute readable ceiling,
zero expired-evidence allowance, and a subsequent 24-hour purge deadline.

**Decision: leave current-observation disabled for now.** No representative enabled workload was
run, so actual ship/location/enrichment attempts, cache hits, retry/cooldown rates, queue lag,
database writes and purge completion are unmeasured. The user selected the task's disabled
alternative rather than accepting a capacity limit or enabling development collection. A
read-only check in both the shared and isolated fixture databases returned `f|0|0`: section
disabled, zero ship/location collection-state rows, and zero retained observations. Future
development enablement still requires the controlled workload, current exact-character SSO and
disclosure, measured purge deadlines, and capacity acceptance. Production also requires separate
privacy acceptance. Controlled development verification and disable-and-purge rollback remain
pending until those gates are met.
