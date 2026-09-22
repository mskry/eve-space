import { defineConfig } from 'vitest/config'
import { apiCoverageThresholdScopes } from './vitest.coverage-thresholds.js'

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'node',
    env: {
      DATABASE_URL: 'postgres://localhost:5432/eve_space',
    },
    maxWorkers: 4,
    include: ['tests/integration/postgres/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage-postgres',
      thresholds: apiCoverageThresholdScopes.postgres.thresholds,
    },
  },
})
