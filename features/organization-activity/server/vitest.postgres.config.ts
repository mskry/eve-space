import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { DATABASE_URL: 'postgres://localhost:5432/eve_space' },
    fileParallelism: false,
    hookTimeout: 60_000,
    include: ['test/integration/postgres/**/*.test.ts'],
    testTimeout: 60_000,
  },
})
