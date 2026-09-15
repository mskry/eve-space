import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#build/eve-space-platform/query-admission-scopes': fileURLToPath(
        new URL('./test/support/query-admission-scopes.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['test/**'],
      reporter: [
        'text',
        'json-summary',
        'html',
        ['lcov', { projectRoot: fileURLToPath(new URL('../..', import.meta.url)) }],
      ],
      reportsDirectory: 'coverage',
    },
  },
})
