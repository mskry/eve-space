# EVE Space Verification

## Running and verifying

- Follow the root affected-scope policy; package scripts and Vitest include/exclude patterns are authoritative. Commit/push hooks and CI retain their broad gates.
- API unit tests: `pnpm --filter @eve-space/api test <test-path>`. For PostgreSQL changes, use `pnpm --filter @eve-space/api test:postgres <test-path>`; for focused Redis checks, use `pnpm --filter @eve-space/api test:redis:no-coverage <test-path>`.
- Do not add coverage to a single focused test merely to repeat the CI gate: API unit coverage and the Redis coverage runner enforce whole-suite thresholds. Use their full coverage runners when that coverage gate is required.
- Frontend pure logic: `pnpm exec vitest run --config vitest.config.ts <test-path>`; Nuxt/UI: `pnpm exec vitest run --config vitest.ui.config.ts <test-path>`. Registry tests use `vitest.registry.config.ts`; do not guess the runner from the filename.
- Browser tests consume a fixture production build: run `pnpm test:e2e:build` before `pnpm test:e2e:built <test-path>`, unless the current matching build already exists.
- For GraphQL generation or operation-contract changes, regenerate with `pnpm graphql:generate`, then run `pnpm graphql:check` and the affected tests. Generation writes shared artifacts; complete it before dependent checks.
- For generator/toolchain or public ESI package changes, use the complete package validation described in `packages/esi-client/README.md`; unrelated API edits do not require repeating it.
- For boundary-only changes, run the affected `scripts/verify-*` checker rather than the entire workspace lint matrix.
- Do not interpret source checks as deployment probes, or rerun completed checks whose inputs have not changed. Report checks run, CI or hook gates relied on, and unresolved verification gaps.

## Existing test-location migration policy

- Organize root frontend tests by feature or cross-cutting concern. Use this target structure for a later behavior-free test-location refactor:

```text
tests/
  character/
    clone-resource-state.test.ts
  dashboard/
    dashboard-sections.test.ts
  e2e/
    nuxt-ssr-failure.e2e.test.ts
  mail/
    character-mail-reading.e2e.test.ts
    mail-frontend.test.ts
    mail-queries.test.ts
  platform/
    platform-module-registry.test.ts
  queries/
    protected-queries.test.ts
    query-infrastructure.test.ts
    query-prefetch-hooks.test.ts
    query-ssr-auth.test.ts
  support/
  ui/
    ui-toast.test.ts
  setup.ts
```

- Co-locate feature-specific unit and E2E tests in the feature directory; reserve `tests/e2e/` for cross-feature shell and application journeys. Keep shared fixtures in `tests/support/`, preserve the `.e2e.test.ts` suffix for production-server browser tests, and update exact-path Vitest configs when files move. Perform the remaining test-location migration separately from behavioral changes.
- Keep integration suites with the runtime boundary that owns them instead of creating one repository-wide integration directory. Use these target locations as those suites grow:

```text
api/tests/integration/
  postgres/
  redis/
features/<module>/server/test/integration/
features/<module>/nuxt/test/integration/
packages/<package>/test/integration/
```

- PostgreSQL, Redis, server-module, Nuxt-module, and package integration suites have different dependencies and runners. Keep their package scripts and Vitest configs authoritative, and update include/exclude patterns when migrating existing files into these paths.
