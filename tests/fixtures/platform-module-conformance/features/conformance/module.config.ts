import type { PlatformModuleManifest } from '@eve-space/platform-module-contract'

const manifest = {
  id: 'conformance',
  icon: 'corporation',
  defaultEnabled: true,
  server: {
    package: '@eve-space/conformance-server',
    routes: [
      {
        id: 'conformance-character-status',
        namespace: '/conformance/characters/:characterId',
        exportName: 'conformanceRoutes',
        authorization: 'owned-character',
        audience: 'member',
        requiredPermission: 'conformance.view',
      },
    ],
    migrations: [{ name: 'conformance-001-initial.sql' }],
    resources: [
      {
        id: 'conformance-status',
        operationId: 'conformance-status-operation',
        subjectKind: 'character',
        materializationIntervalSeconds: 300,
        eligibility: { kind: 'current-owned-character' },
        exportName: 'conformanceStatusResource',
      },
    ],
    esiOperations: [
      {
        id: 'conformance-status-operation',
        exportName: 'conformanceStatusOperation',
      },
    ],
    activityProviders: [
      {
        id: 'conformance-activity',
        exportName: 'conformanceActivityProvider',
        audience: 'member',
        requiredPermission: 'conformance.view',
        freshness: { staleAfterSeconds: 300 },
      },
    ],
  },
  nuxt: {
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
  },
} satisfies PlatformModuleManifest

export default manifest
