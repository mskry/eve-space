import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // e2e specs boot a real Nuxt build + server; they run via `pnpm test:e2e`.
    exclude: [...configDefaults.exclude, 'tests/**/*.e2e.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['app/queries/**/*.ts', 'app/utils/colada-options.ts', 'app/utils/query-error.ts'],
      thresholds: {
        branches: 60,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },
  },
})
