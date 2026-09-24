import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      include: [
        'src/queue/redis.ts',
        'src/queue/platform.ts',
        'src/esi-gateway/internal/coordination.ts',
        'src/esi-gateway/internal/cooldowns.ts',
        'src/esi-gateway/failures.ts',
        'src/esi-gateway/internal/local-quota.ts',
        'src/esi-gateway/internal/permits.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage-redis',
      thresholds: {
        branches: 45,
        functions: 65,
        lines: 65,
        statements: 65,
      },
    },
    env: {
      DATABASE_URL: 'postgres://localhost:5432/eve_space',
    },
    environment: 'node',
    hookTimeout: 60_000,
    include: ['tests/integration/redis/**/*.test.ts'],
    testTimeout: 60_000,
  },
})
