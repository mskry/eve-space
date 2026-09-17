import type { PlatformModuleManifest } from '@eve-space/platform-module-contract/manifest'

const manifest = {
  id: 'organization-activity',
  icon: 'corporation',
  defaultEnabled: true,
  server: {
    package: '@eve-space/organization-activity-server',
    routes: [
      {
        id: 'activity-details',
        namespace: '/organization-activity/details',
        exportName: 'activityRoutes',
        authorization: 'authenticated-session',
        audience: 'member',
        requiredPermission: 'organization-activity.view',
        persistenceOperations: [{ operationId: 'read-activity-snapshots' }],
      },
      {
        id: 'activity-participation',
        namespace: '/organization-activity/characters/:characterId',
        exportName: 'participationRoutes',
        authorization: 'owned-character',
        audience: 'member',
        requiredPermission: 'organization-activity.view',
        persistenceOperations: [{ operationId: 'read-activity-snapshots' }],
      },
    ],
    migrations: [
      {
        name: 'organization-activity-001-baseline.sql',
      },
    ],
    persistenceOperations: [
      {
        id: 'read-activity-checkpoint',
        method: 'readActivityCheckpoint',
        revision: 1,
        mode: 'read',
        exportName: 'readActivityCheckpointOperation',
        migration: 'organization-activity-001-baseline.sql',
      },
      {
        id: 'read-activity-snapshots',
        method: 'readActivitySnapshots',
        revision: 1,
        mode: 'read',
        exportName: 'readActivitySnapshotsOperation',
        migration: 'organization-activity-001-baseline.sql',
      },
      {
        id: 'materialize-activity-observation',
        method: 'materializeActivityObservation',
        revision: 1,
        mode: 'write',
        exportName: 'materializeActivityObservationOperation',
        migration: 'organization-activity-001-baseline.sql',
      },
    ],
    resources: [
      {
        id: 'campaigns',
        operationId: 'organization-activity-campaign-list',
        dependentOperationIds: [
          'organization-activity-campaign-detail',
          'organization-activity-objective-list',
          'organization-activity-objective-detail',
        ],
        subjectKind: 'deployment',
        materializationIntervalSeconds: 60,
        eligibility: {
          kind: 'current-deployment',
        },
        persistence: {
          projection: [{ operationId: 'read-activity-checkpoint' }],
          materialization: [{ operationId: 'materialize-activity-observation' }],
        },
        exportName: 'campaignsResource',
      },
      {
        id: 'public-jobs',
        operationId: 'organization-activity-job-list',
        dependentOperationIds: ['organization-activity-job-detail'],
        subjectKind: 'deployment',
        materializationIntervalSeconds: 60,
        eligibility: {
          kind: 'current-deployment',
        },
        persistence: {
          projection: [{ operationId: 'read-activity-checkpoint' }],
          materialization: [{ operationId: 'materialize-activity-observation' }],
        },
        exportName: 'publicJobsResource',
      },
      {
        id: 'corporation-jobs',
        operationId: 'organization-activity-corporation-jobs',
        dependentOperationIds: [],
        subjectKind: 'corporation',
        materializationIntervalSeconds: 60,
        eligibility: {
          kind: 'current-managed-corporation-source',
        },
        persistence: {
          projection: [{ operationId: 'read-activity-checkpoint' }],
          materialization: [{ operationId: 'materialize-activity-observation' }],
        },
        exportName: 'corporationJobsResource',
      },
      {
        id: 'corporation-projects',
        operationId: 'organization-activity-project-list',
        dependentOperationIds: ['organization-activity-project-detail'],
        subjectKind: 'corporation',
        materializationIntervalSeconds: 60,
        eligibility: {
          kind: 'current-managed-corporation-source',
        },
        persistence: {
          projection: [{ operationId: 'read-activity-checkpoint' }],
          materialization: [{ operationId: 'materialize-activity-observation' }],
        },
        exportName: 'corporationProjectsResource',
      },
      {
        id: 'character-jobs',
        operationId: 'organization-activity-character-jobs',
        dependentOperationIds: ['organization-activity-job-participation'],
        subjectKind: 'character',
        materializationIntervalSeconds: 60,
        eligibility: {
          kind: 'current-owned-character',
        },
        persistence: {
          projection: [{ operationId: 'read-activity-checkpoint' }],
          materialization: [{ operationId: 'materialize-activity-observation' }],
        },
        exportName: 'characterJobsResource',
      },
      {
        id: 'character-campaigns',
        operationId: 'organization-activity-character-objectives',
        dependentOperationIds: ['organization-activity-objective-participation'],
        subjectKind: 'character',
        materializationIntervalSeconds: 60,
        eligibility: {
          kind: 'current-owned-character',
        },
        persistence: {
          projection: [{ operationId: 'read-activity-checkpoint' }],
          materialization: [{ operationId: 'materialize-activity-observation' }],
        },
        exportName: 'characterCampaignsResource',
      },
      {
        id: 'character-projects',
        operationId: 'organization-activity-project-list',
        dependentOperationIds: ['organization-activity-project-contribution'],
        subjectKind: 'character',
        materializationIntervalSeconds: 60,
        eligibility: {
          kind: 'current-owned-character',
        },
        persistence: {
          projection: [{ operationId: 'read-activity-checkpoint' }],
          materialization: [{ operationId: 'materialize-activity-observation' }],
        },
        exportName: 'characterProjectsResource',
      },
    ],
    esiOperations: [
      {
        id: 'organization-activity-campaign-list',
        exportName: 'campaignListOperation',
      },
      {
        id: 'organization-activity-campaign-detail',
        exportName: 'campaignDetailOperation',
      },
      {
        id: 'organization-activity-objective-list',
        exportName: 'objectiveListOperation',
      },
      {
        id: 'organization-activity-objective-detail',
        exportName: 'objectiveDetailOperation',
      },
      {
        id: 'organization-activity-job-list',
        exportName: 'jobListOperation',
      },
      {
        id: 'organization-activity-job-detail',
        exportName: 'jobDetailOperation',
      },
      {
        id: 'organization-activity-corporation-jobs',
        exportName: 'corporationJobsOperation',
      },
      {
        id: 'organization-activity-project-list',
        exportName: 'projectListOperation',
      },
      {
        id: 'organization-activity-project-detail',
        exportName: 'projectDetailOperation',
      },
      {
        id: 'organization-activity-project-contribution',
        exportName: 'projectContributionOperation',
      },
      {
        id: 'organization-activity-character-jobs',
        exportName: 'characterJobsOperation',
      },
      {
        id: 'organization-activity-job-participation',
        exportName: 'jobParticipationOperation',
      },
      {
        id: 'organization-activity-character-objectives',
        exportName: 'characterObjectivesOperation',
      },
      {
        id: 'organization-activity-objective-participation',
        exportName: 'objectiveParticipationOperation',
      },
    ],
    activityProviders: [
      {
        id: 'organization-activity',
        exportName: 'organizationActivityProvider',
        audience: 'member',
        requiredPermission: 'organization-activity.view',
        persistenceOperations: [{ operationId: 'read-activity-snapshots' }],
        freshness: {
          staleAfterSeconds: 3600,
        },
      },
    ],
  },
  nuxt: {
    package: '@eve-space/organization-activity-nuxt',
    pages: [
      {
        id: 'organization-activity-projects',
        name: 'eve-organization-activity-projects',
        path: '/organization-activity/projects',
        file: 'src/runtime/app/pages/OrganizationActivityProjectPage.vue',
        extensionPoint: 'root',
        audience: 'authenticated',
      },
      {
        id: 'organization-activity-jobs',
        name: 'eve-organization-activity-jobs',
        path: '/organization-activity/jobs',
        file: 'src/runtime/app/pages/OrganizationActivityJobPage.vue',
        extensionPoint: 'root',
        audience: 'authenticated',
      },
      {
        id: 'organization-activity-campaigns',
        name: 'eve-organization-activity-campaigns',
        path: '/organization-activity/campaigns',
        file: 'src/runtime/app/pages/OrganizationActivityCampaignPage.vue',
        extensionPoint: 'root',
        audience: 'authenticated',
      },
    ],
    navigation: [],
  },
} satisfies PlatformModuleManifest

export default manifest
