import { defineConfig } from 'vitest/config'
import { apiCoverageThresholdScopes } from './vitest.coverage-thresholds.js'

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      exclude: [
        'src/{env,server}.ts',
        'src/commands/{local-organization-fixture,redrive-domain-events,seed-local-organization-fixture,verify-worker-rollback}.ts',
        'src/generated/**/*.ts',
        'src/admin/store.ts',
        'src/db/{client,migrate,migration-runner,module-migration-runner,module-persistence-provisioner,schema,startup-migrations}.ts',
        'src/db/schema/**/*.ts',
        'src/domain-events/store.ts',
        'src/cache-redis.ts',
        'src/esi-gateway/internal/{coordination,types}.ts',
        'src/characters/corporation-role-{evidence,invalidation,observation}.ts',
        'src/organization/{authority-convergence,corporation-role-bootstrap,corporation-role-convergence,corporation-role-demand,corporation-role-diagnostics,corporation-role-refresh,corporation-sources,effective-authority,owner-claim,owner-source-replacement,role-store}.ts',
        'src/organization/{alliance-executor-convergence,alliance-executor-evidence,alliance-executor-repair,group-assignment-expiry,group-permission-reader,group-rule-attestation-store,group-rule-convergence,group-rule-repair,group-rule-revisions,group-rule-store,rule-evidence}.ts',
        'src/queue/{platform,redis,worker-identity}.ts',
        'src/worker/health.ts',
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
        statements: 80,
        ...apiCoverageThresholdScopes.api.thresholds,
      },
    },
    env: {
      DATABASE_URL: 'postgres://localhost:5432/eve_space',
    },
    environment: 'node',
    exclude: ['tests/integration/**/*.test.ts', 'tests/packaging/**/*.test.ts'],
    include: ['tests/**/*.test.ts'],
    maxWorkers: 4,
  },
})
