import type { PlatformModuleManifest } from '@eve-space/platform-module-contract/manifest'

const manifest = {
  id: 'member-audit',
  icon: 'corporation',
  defaultEnabled: false,
  sections: [
    { id: 'overview', kind: 'workspace', defaultEnabled: false },
    { id: 'skills', kind: 'sensitive-evidence', defaultEnabled: false, disclosureRevision: 1 },
    { id: 'assets', kind: 'sensitive-evidence', defaultEnabled: false, disclosureRevision: 1 },
    { id: 'wallet', kind: 'sensitive-evidence', defaultEnabled: false, disclosureRevision: 1 },
    { id: 'mail', kind: 'sensitive-evidence', defaultEnabled: false, disclosureRevision: 1 },
    { id: 'access-management', kind: 'access-management', defaultEnabled: false },
  ],
  server: {
    package: '@eve-space/member-audit-server',
    routes: [
      {
        id: 'member-search',
        namespace: '/member-audit/search',
        exportName: 'memberSearchRoutes',
        authorization: 'authenticated-session',
        audience: 'hr',
        requiredPermission: 'member-audit.search',
        additionalRequiredPermissions: ['member-audit.summary.read'],
        sectionId: 'overview',
        target: 'managed-organization-account-search',
        exposure: 'standard',
        persistenceOperations: [],
      },
      {
        id: 'member-summary',
        namespace: '/member-audit/accounts/:userId',
        exportName: 'memberSummaryRoutes',
        authorization: 'authenticated-session',
        audience: 'hr',
        requiredPermission: 'member-audit.summary.read',
        sectionId: 'overview',
        target: 'managed-organization-account',
        exposure: 'standard',
        persistenceOperations: [],
      },
    ],
    migrations: [{ name: 'member-audit-001-baseline.sql' }],
    persistenceOperations: [
      {
        id: 'write-skill-snapshot',
        method: 'writeSkillSnapshot',
        revision: 1,
        mode: 'write',
        exportName: 'writeSkillSnapshotOperation',
        migration: 'member-audit-001-baseline.sql',
      },
    ],
    resources: [
      {
        id: 'trained-skills',
        operationId: 'skills',
        dependentOperationIds: [],
        coreDataProducts: ['published-skill-catalogue'],
        sectionId: 'skills',
        subjectKind: 'character',
        materializationIntervalSeconds: 3600,
        eligibility: { kind: 'current-managed-member-character' },
        persistence: {
          projection: [],
          materialization: [{ operationId: 'write-skill-snapshot' }],
        },
        exportName: 'trainedSkillsResource',
      },
      {
        id: 'skill-queue',
        operationId: 'skill-queue',
        dependentOperationIds: [],
        coreDataProducts: ['published-skill-catalogue'],
        sectionId: 'skills',
        subjectKind: 'character',
        materializationIntervalSeconds: 900,
        eligibility: { kind: 'current-managed-member-character' },
        persistence: {
          projection: [],
          materialization: [{ operationId: 'write-skill-snapshot' }],
        },
        exportName: 'skillQueueResource',
      },
    ],
    esiOperations: [],
    activityProviders: [],
  },
  nuxt: {
    package: '@eve-space/member-audit-nuxt',
    pages: [],
    navigation: [],
  },
} satisfies PlatformModuleManifest

export default manifest
