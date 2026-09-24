import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    hookTimeout: 300_000,
    include: ['tests/packaging/**/*.test.ts'],
    testTimeout: 60_000,
  },
})
