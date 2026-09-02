import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    coverage: {
      include: ['app/**/*.vue', 'layers/ui/app/**/*.{ts,vue}'],
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: 'coverage/ui',
    },
    environment: 'nuxt',
    include: [
      'tests/character/**/*.nuxt.test.ts',
      'tests/finance/**/*.nuxt.test.ts',
      'tests/ui/**/*.nuxt.test.ts',
    ],
    maxWorkers: 1,
    pool: 'forks',
  },
})
