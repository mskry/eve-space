import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'node',
    env: {
      DATABASE_URL: 'postgres://localhost:5432/eve_space',
    },
    include: ['tests/integration/redis/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: [
        'src/queue/redis.ts',
        'src/queue/platform.ts',
        'src/esi-gateway/internal/coordination.ts',
        'src/esi-gateway/internal/cooldowns.ts',
        'src/esi-gateway/failures.ts',
        'src/esi-gateway/internal/local-quota.ts',
        'src/esi-gateway/internal/permits.ts',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage-redis',
      thresholds: {
        branches: 45,
        functions: 65,
        lines: 65,
        statements: 65,
      },
    },
  },
})
