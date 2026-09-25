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
      'src/characters/corporation-role-evidence.ts': {
        branches: 75,
        functions: 85,
        lines: 90,
        statements: 90,
      },
      'src/characters/corporation-role-invalidation.ts': {
        branches: 65,
        functions: 100,
        lines: 90,
        statements: 90,
      },
      'src/characters/corporation-role-observation.ts': {
        branches: 75,
        functions: 95,
        lines: 80,
        statements: 80,
      },
      'src/organization/corporation-role-bootstrap.ts': {
        branches: 75,
        functions: 100,
        lines: 85,
        statements: 85,
      },
      'src/organization/corporation-role-convergence.ts': {
        branches: 65,
        functions: 80,
        lines: 80,
        statements: 80,
      },
      'src/organization/corporation-role-demand.ts': {
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95,
      },
      'src/organization/corporation-role-diagnostics.ts': {
        branches: 55,
        functions: 100,
        lines: 85,
        statements: 85,
      },
      'src/organization/corporation-role-refresh.ts': {
        branches: 80,
        functions: 100,
        lines: 75,
        statements: 75,
      },
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
