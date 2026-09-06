import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'node',
    env: {
      DATABASE_URL: 'postgres://localhost:5432/eve_space',
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**/*.test.ts', 'tests/packaging/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/{env,index,server,worker}.ts',
        'src/commands/**/*.ts',
        'src/generated/**/*.ts',
        'src/admin/store.ts',
        'src/auth/store.ts',
        'src/db/{client,migrate,migration-runner,module-migration-runner,module-persistence,module-persistence-provisioner,schema,startup-migrations}.ts',
        'src/db/schema/**/*.ts',
        'src/domain-events/store.ts',
        'src/esi-resilience/{cache-redis,coordination,types}.ts',
        'src/queue/{platform,redis,worker-identity}.ts',
        'src/worker/health.ts',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
})
