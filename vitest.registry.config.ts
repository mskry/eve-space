import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@eve-space/platform-module-server': fileURLToPath(
        new URL('./packages/platform-module-server/src/index.ts', import.meta.url),
      ),
      zod: fileURLToPath(new URL('./api/node_modules/zod/index.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/platform/esi-resilience-boundaries.test.ts',
      'tests/platform/organization-boundaries.test.ts',
      'tests/platform/platform-boundaries.test.ts',
      'tests/platform/module-composition-side-effects.test.ts',
      'tests/platform/module-package-boundaries.test.ts',
      'tests/platform/platform-module-registry.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage-registry',
    },
  },
})
