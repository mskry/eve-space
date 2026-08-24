import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'node',
    env: {
      DATABASE_URL: 'postgres://localhost:5432/eve_space',
    },
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/integration/redis/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
