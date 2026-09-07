import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '#imports': fileURLToPath(new URL('./test/support/imports.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/schema.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 75 },
    },
  },
})
