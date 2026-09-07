import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/integration/postgres/**/*.test.ts'],
    env: { DATABASE_URL: 'postgres://localhost:5432/eve_space' },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
