import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/platform/platform-module-registry.test.ts'],
  },
})
