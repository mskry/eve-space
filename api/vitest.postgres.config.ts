import { defineConfig } from 'vitest/config'
import { apiCoverageThresholdScopes } from './vitest.coverage-thresholds.js'

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage-postgres',
      thresholds: apiCoverageThresholdScopes.postgres.thresholds,
    },
    env: {
      DATABASE_URL: 'postgres://localhost:5432/eve_space',
    },
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 60_000,
    include: ['tests/integration/postgres/**/*.test.ts'],
    testTimeout: 60_000,
  },
})
