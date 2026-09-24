import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: [
        'text',
        'json-summary',
        ['lcov', { projectRoot: fileURLToPath(new URL('../..', import.meta.url)) }],
      ],
      reportsDirectory: 'coverage',
    },
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
