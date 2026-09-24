import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      exclude: ['src/index.ts', 'src/schema.ts'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: { branches: 75, functions: 80, lines: 80, statements: 80 },
    },
    exclude: ['test/integration/**/*.test.ts'],
    include: ['test/**/*.test.ts'],
  },
})
