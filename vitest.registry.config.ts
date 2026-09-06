import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/platform/esi-resilience-boundaries.test.ts',
      'tests/platform/organization-boundaries.test.ts',
      'tests/platform/platform-boundaries.test.ts',
      'tests/platform/platform-module-registry.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage-registry',
    },
  },
})
