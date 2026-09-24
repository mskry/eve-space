import type { PlatformModuleManifest } from '@eve-space/platform-module-contract/manifest'

const manifest = {
  defaultEnabled: true,
  icon: 'corporation',
  id: 'conformance',
  nuxt: {
    navigation: [
      {
        id: 'conformance-activity-navigation',
        label: 'Conformance activity',
        description: 'Production-shaped module conformance activity',
        to: '/conformance/:characterId',
        audience: 'owned-character',
        placement: 'dashboard',
        order: 90,
        pageName: 'eve-conformance-activity',
      },
    ],
    package: '@eve-space/conformance-nuxt',
    pages: [
      {
        id: 'conformance-activity-page',
        name: 'eve-conformance-activity',
        path: '/conformance/:characterId',
        file: 'src/runtime/app/pages/ConformanceActivityPage.vue',
        extensionPoint: 'root',
        audience: 'owned-character',
      },
    ],
  },
  release: {
    hostContractRange: '^1.0.0',
    publisherPackage: '@eve-space/conformance-manifest',
    version: '0.1.0',
  },
  server: {
    activityProviders: [
      {
        id: 'conformance-activity',
        exportName: 'conformanceActivityProvider',
        audience: 'member',
        requiredPermission: 'conformance.view',
        persistenceOperations: [{ operationId: 'read-conformance-snapshot' }],
        freshness: { staleAfterSeconds: 300 },
      },
    ],
    esiOperations: [
      {
        id: 'conformance-status-operation',
        exportName: 'conformanceStatusOperation',
      },
    ],
    migrations: [
      { name: 'conformance-001-initial.sql' },
      { name: 'conformance-002-persistence-operations.sql' },
    ],
    package: '@eve-space/conformance-server',
    persistenceOperations: [
      {
        id: 'read-conformance-snapshot',
        method: 'readConformanceSnapshot',
        revision: 1,
        mode: 'read',
        exportName: 'readConformanceSnapshotOperation',
        migration: 'conformance-002-persistence-operations.sql',
      },
      {
        id: 'upsert-conformance-snapshot',
        method: 'upsertConformanceSnapshot',
        revision: 1,
        mode: 'write',
        exportName: 'upsertConformanceSnapshotOperation',
        migration: 'conformance-002-persistence-operations.sql',
      },
    ],
    resources: [
      {
        id: 'conformance-status',
        operationId: 'conformance-status-operation',
        coreDataProducts: ['published-type-groups'],
        subjectKind: 'character',
        materializationIntervalSeconds: 300,
        eligibility: { kind: 'current-owned-character' },
        persistence: {
          projection: [],
          materialization: [{ operationId: 'upsert-conformance-snapshot' }],
        },
        exportName: 'conformanceStatusResource',
      },
      {
        id: 'conformance-collection',
        operationId: 'conformance-status-operation',
        coreDataProducts: [],
        dependentOperationIds: ['universe-resolve-names'],
        subjectKind: 'character',
        materializationIntervalSeconds: 300,
        eligibility: { kind: 'current-owned-character' },
        persistence: {
          projection: [{ operationId: 'read-conformance-snapshot' }],
          materialization: [{ operationId: 'upsert-conformance-snapshot' }],
        },
        exportName: 'conformanceCollectionResource',
      },
    ],
    routes: [
      {
        id: 'conformance-character-status',
        namespace: '/conformance/characters/:characterId',
        exportName: 'conformanceRoutes',
        authorization: 'owned-character',
        audience: 'member',
        requiredPermission: 'conformance.view',
        persistenceOperations: [],
      },
    ],
  },
} satisfies PlatformModuleManifest

export default manifest
