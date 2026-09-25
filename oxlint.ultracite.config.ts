import { defineConfig } from 'oxlint'
import antiSlop from 'ultracite/oxlint/anti-slop'
import core from 'ultracite/oxlint/core'
import vitest from 'ultracite/oxlint/vitest'
import vue from 'ultracite/oxlint/vue'

import current from './.oxlintrc.json' with { type: 'json' }

export default defineConfig({
  extends: [core, vue, vitest, antiSlop, current],
  ignorePatterns: [...core.ignorePatterns, ...current.ignorePatterns],
  jsPlugins: ['oxlint-plugin-complexity'],
  overrides: [
    {
      // Tests deliberately inspect malformed values and assert boundary behavior.
      files: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.test.tsx',
        '**/*.spec.tsx',
        'api/tests/esi-gateway/registered-caller-test-adapters.ts',
        'api/tests/platform/module-route-composition.types.ts',
        'api/tests/support/mock-feature-execution.ts',
        'tests/support/auth-e2e-stack.ts',
      ],
      rules: {
        'anti-slop/no-module-mocking': 'off',
        'anti-slop/no-runtime-typeof': 'off',
      },
    },
    {
      files: ['scripts/quality-lint-baseline.ts', 'scripts/quality-lint-diagnostics.ts'],
      rules: { 'anti-slop/no-runtime-typeof': 'off' },
    },
    {
      // The SDK independently lints its boundary-heavy runtime, OpenAPI generator, and tests.
      files: ['packages/esi-client/**'],
      rules: { 'anti-slop/no-runtime-typeof': 'off' },
    },
    {
      // Dynamic SDK descriptors are registered against generated operation types at startup;
      // the ID-only dispatch type cannot express that relationship.
      files: [
        'api/src/esi-gateway/internal/execution-runtime.ts',
        'packages/esi-client/scripts/check-documentation.ts',
        'packages/esi-client/src/client/request-schema.ts',
      ],
      rules: { 'anti-slop/no-chained-type-assertions': 'off' },
    },
    {
      // These tests exercise malformed input or narrow driver/client doubles deliberately.
      files: [
        'api/tests/admin/routes.test.ts',
        'api/tests/db/module-persistence-attestation.test.ts',
        'api/tests/db/module-persistence-operation-transaction.test.ts',
        'api/tests/db/module-persistence-operation.test.ts',
        'api/tests/organization/route-middleware.test.ts',
        'api/tests/platform/resource-operation-policy.test.ts',
        'features/organization-activity/server/test/collection.test.ts',
        'packages/esi-client/tests/domain-client-emitter.test.ts',
        'packages/esi-client/tests/generation-pipeline.test.ts',
        'tests/organization/organization-review-queries.test.ts',
        'tests/queries/private-query-lifecycle.test.ts',
      ],
      rules: { 'anti-slop/no-chained-type-assertions': 'off' },
    },
    {
      // Boundary decoders, runtime API checks, and variant dispatch need to inspect JS values.
      // Keep those checks where an external contract cannot supply a discriminant or parser.
      files: [
        'api/src/auth/character-token-store.ts',
        'api/src/auth/character-transfer-store.ts',
        'api/src/cache-admission/service.ts',
        'api/src/corporations/public-data.ts',
        'api/src/db/migration-runner.ts',
        'api/src/esi-gateway/feature-execution.ts',
        'api/src/esi-gateway/internal/cache-redaction.ts',
        'api/src/esi-gateway/internal/catalog-validation.ts',
        'api/src/esi-gateway/internal/coordination.ts',
        'api/src/index.ts',
        'api/src/organization/reviewer-group-policy.ts',
        'api/src/platform/resource-batch.ts',
        'api/src/queue/job-handlers.ts',
        'app/composables/useCustomHighlight.ts',
        'app/pages/characters/index.vue',
        'app/query-persistence/runtime.ts',
        'app/utils/colada-options.ts',
        'app/utils/organization-review.ts',
        'features/member-audit/nuxt/src/runtime/app/reviewer/overview.vue',
        'features/member-audit/server/src/evidence-maintenance.ts',
        'features/organization-activity/nuxt/src/runtime/app/composables/useActivityDetail.ts',
        'layers/ui/app/components/ui/UiToggleGroup.vue',
        'packages/platform-module-server/src/errors.ts',
        'scripts/module-registry/feature-boundaries.ts',
        'scripts/module-registry/server-sources.ts',
        'scripts/verify-esi-egress.mjs',
        'app/query-persistence/envelope.ts',
        'app/query-persistence/notifications.ts',
        'app/query-persistence/storage.ts',
        'app/utils/auth-redirect.ts',
        'app/utils/esi-freshness.ts',
        'app/utils/route-id.ts',
        'api/src/core-data/coverage-validation.ts',
        'api/src/core-data/capabilities.ts',
        'api/src/core-data/product-catalog.ts',
        'api/src/core-data/sde-product-adapter.ts',
        'api/src/db/module-migration-runner.ts',
        'api/src/domain-events/definitions.ts',
        'api/src/esi-gateway/catalog-interface.ts',
        'api/src/esi-gateway/internal/identity.ts',
        'api/src/esi-gateway/internal/runtime-state.ts',
        'api/src/esi-gateway/internal/telemetry-counters.ts',
        'api/src/logging.ts',
        'api/src/organization/reviewer-account-search.ts',
        'api/src/platform/module-logging.ts',
        'api/src/platform/resource-declarations.ts',
        'api/src/queue/platform.ts',
        'api/src/universe/resolution-cache.ts',
        'api/src/universe/static-location-store.ts',
        'api/src/universe/topology-store.ts',
        'api/src/worker/rollback-verifier.ts',
        'features/organization-activity/server/src/collection-response.ts',
        'packages/platform-module-nuxt/src/runtime/esi-query-persistence.ts',
        'packages/platform-module-nuxt/src/runtime/app/middleware/platform-module-enablement.global.ts',
        'packages/platform-module-nuxt/src/runtime/query-error.ts',
        'packages/esi-client-codegen/src/index.ts',
        'packages/platform-module-conformance/src/conformance.ts',
        'packages/platform-module-conformance/src/source-policy.ts',
        'packages/platform-module-contract/src/compiler.ts',
        'packages/platform-module-contract/src/publisher.ts',
        'packages/platform-module-contract/src/validation.ts',
        'packages/platform-module-persistence-policy/src/module-migration-ast-policy.ts',
        'packages/platform-module-persistence-policy/src/module-persistence-routine.ts',
        'packages/platform-module-persistence-policy/src/postgres17-parser.ts',
        'scripts/module-registry/resolved-release.ts',
      ],
      rules: { 'anti-slop/no-runtime-typeof': 'off' },
    },
  ],
  rules: {
    // This plugin counts nested callbacks directly; its score is distinct from Sonar S3776.
    'complexity/complexity': ['error', { cognitive: 15 }],
    // Ultracite's rule option is unsupported by the pinned Oxlint 1.81.
    'no-unmodified-loop-condition': 'error',
  },
})
