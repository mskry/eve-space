import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
