import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // e2e specs boot a real Nuxt build + server; they run via `pnpm test:e2e`.
    exclude: [
      ...configDefaults.exclude,
      'tests/**/*.e2e.test.ts',
      'tests/**/*.nuxt.test.ts',
      'tests/platform/auth-boundaries.test.ts',
      'tests/platform/esi-resilience-boundaries.test.ts',
      'tests/platform/module-composition-side-effects.test.ts',
      'tests/platform/module-package-boundaries.test.ts',
      'tests/platform/organization-boundaries.test.ts',
      'tests/platform/platform-boundaries.test.ts',
      'tests/platform/queue-boundaries.test.ts',
      'tests/platform/platform-module-conformance.test.ts',
      'tests/platform/platform-module-registry.test.ts',
    ],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      exclude: ['**/*.d.ts'],
      include: ['app/**/*.ts', 'layers/ui/app/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: 'coverage/frontend',
      thresholds: {
        'app/{queries,utils}/**/*.ts': {
          branches: 60,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
    },
  },
})
