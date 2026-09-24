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
    coverage: {
      exclude: ['test/**'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: [
        'text',
        'json-summary',
        'html',
        ['lcov', { projectRoot: fileURLToPath(new URL('../..', import.meta.url)) }],
      ],
      reportsDirectory: 'coverage',
    },
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ['test/**/*.test.ts'],
    maxWorkers: 1,
    pool: 'forks',
    testTimeout: 60_000,
  },
})
