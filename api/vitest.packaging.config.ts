import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/packaging/**/*.test.ts'],
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
})
