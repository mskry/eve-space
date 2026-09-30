import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: ['src/runtime/app/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
    },
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.nuxt.test.ts'],
  },
})
