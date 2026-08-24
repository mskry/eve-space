import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // These specs boot the production build created by `pnpm test:e2e`, so they
    // are kept out of the default unit run (see vitest.config.ts).
    environment: 'node',
    include: ['tests/**/*.e2e.test.ts'],
    // No MSW setup here: the e2e server must reach the real network stack.
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 60_000,
    teardownTimeout: 30_000,
  },
})
