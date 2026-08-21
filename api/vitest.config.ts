import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/deployment-organization.ts',
        'src/character-history-service.ts',
        'src/character-skills-service.ts',
        'src/middleware/auth-session.ts',
        'src/middleware/owned-character.ts',
        'src/routes/characters.ts',
        'src/routes/admin.ts',
        'src/sso-routes.ts',
        'src/routes/status.ts',
        'src/system-status-service.ts',
        'src/wallet-service.ts',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
})
