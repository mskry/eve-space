import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '#imports': fileURLToPath(new URL('./test/support/imports.ts', import.meta.url)) },
  },
  test: {
    coverage: {
      exclude: ['src/index.ts', 'src/schema.ts'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: { branches: 75, functions: 80, lines: 80, statements: 80 },
    },
    include: ['test/**/*.test.ts'],
  },
})
