export const coverageThresholdScopes = {
  frontend: {
    root: '.',
    thresholds: {
      'app/composables/mail-composition-draft.ts': {
        branches: 45,
        functions: 75,
        lines: 80,
        statements: 75,
      },
      'app/composables/mail-composition-submission.ts': {
        branches: 80,
        functions: 100,
        lines: 100,
        statements: 90,
      },
      'app/composables/useMailComposition.ts': {
        branches: 80,
        functions: 100,
        lines: 100,
        statements: 100,
      },
      'app/utils/mail-composition.ts': {
        branches: 80,
        functions: 100,
        lines: 100,
        statements: 95,
      },
    },
  },
  registry: {
    root: '.',
    thresholds: {
      'scripts/auth/boundaries.ts': {
        branches: 85,
        functions: 95,
        lines: 95,
        statements: 95,
      },
      'scripts/mail-composition/boundaries.ts': {
        branches: 80,
        functions: 100,
        lines: 95,
        statements: 90,
      },
      'scripts/organization/boundaries.ts': {
        branches: 90,
        functions: 90,
        lines: 95,
        statements: 90,
      },
    },
  },
} as const
