import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@eve-space/conformance-server': fileURLToPath(
        new URL(
          './tests/fixtures/platform-module-conformance/features/conformance/server/src/index.ts',
          import.meta.url,
        ),
      ),
      '@eve-space/platform-module-server': fileURLToPath(
        new URL('./packages/platform-module-server/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    clearMocks: true,
    environment: 'node',
    hookTimeout: 120_000,
    include: [
      'tests/platform/module-composition-side-effects.test.ts',
      'tests/platform/platform-module-conformance.test.ts',
      'tests/platform/platform-module-conformance.nuxt.test.ts',
      'api/tests/integration/postgres/platform-module-conformance.test.ts',
    ],
    maxWorkers: 1,
    testTimeout: 60_000,
  },
})
