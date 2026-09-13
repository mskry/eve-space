export const apiCoverageThresholdScopes = {
  api: {
    root: 'api',
    thresholds: {
      'src/auth/oauth-state-store.ts': {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
      'src/organization/route-middleware.ts': {
        branches: 90,
        functions: 100,
        lines: 100,
        statements: 95,
      },
      'src/organization/routes-governance.ts': {
        branches: 80,
        functions: 100,
        lines: 100,
        statements: 90,
      },
      'src/organization/routes-management.ts': {
        branches: 85,
        functions: 100,
        lines: 95,
        statements: 90,
      },
      'src/organization/routes-member.ts': {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
      'src/organization/routes-review.ts': {
        branches: 75,
        functions: 100,
        lines: 85,
        statements: 85,
      },
      'src/organization/routes.ts': {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
  postgres: {
    root: 'api',
    thresholds: {
      'src/auth/character-lifecycle.ts': {
        branches: 75,
        functions: 90,
        lines: 90,
        statements: 85,
      },
      'src/auth/character-lock.ts': {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
      'src/auth/character-token-store.ts': {
        branches: 70,
        functions: 70,
        lines: 75,
        statements: 75,
      },
      'src/auth/oauth-state-store.ts': {
        branches: 90,
        functions: 100,
        lines: 85,
        statements: 85,
      },
      'src/auth/session-store.ts': {
        branches: 50,
        functions: 100,
        lines: 100,
        statements: 85,
      },
    },
  },
} as const
