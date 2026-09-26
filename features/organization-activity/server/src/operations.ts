import { definePlatformExecutableEsiOperation } from '@eve-space/platform-module-server'

const audit = { reviewedDate: '2026-09-07' } as const
const retry = {
  attempts: 2,
  initialDelayMilliseconds: 250,
  kind: 'idempotent',
  maximumDelayMilliseconds: 1000,
} as const

const sharedCache = {
  collapse: true,
  kind: 'shared',
  retentionMilliseconds: 86_400_000,
  stale: { kind: 'bounded', milliseconds: 3_600_000 },
} as const

const privateCache = {
  collapse: true,
  kind: 'shared',
  retentionMilliseconds: 86_400_000,
  stale: { kind: 'outage', milliseconds: 3_600_000 },
} as const

export const campaignListOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: sharedCache,
    identity: { fields: [], kind: 'ordered' },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetMilitaryCampaignsListing',
})

export const campaignDetailOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: sharedCache,
    identity: { fields: [{ kind: 'scalar', field: 'campaignId' }], kind: 'mixed' },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetMilitaryCampaignsDetail',
})

export const objectiveListOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: sharedCache,
    identity: {
      fields: [
        { kind: 'scalar', field: 'campaignId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetMilitaryCampaignsObjectivesListing',
})

export const objectiveDetailOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: sharedCache,
    identity: {
      fields: [
        { kind: 'scalar', field: 'campaignId' },
        { kind: 'scalar', field: 'objectiveId' },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetMilitaryCampaignsObjectivesDetail',
})

export const jobListOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: sharedCache,
    freshness: { kind: 'runtime-only' },
    identity: {
      fields: [
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetFreelanceJobsListing',
})

export const jobDetailOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: sharedCache,
    identity: { fields: [{ kind: 'scalar', field: 'jobId' }], kind: 'mixed' },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetFreelanceJobsDetail',
})

export const corporationJobsOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: privateCache,
    freshness: { kind: 'runtime-only' },
    identity: {
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetCorporationsFreelanceJobsListing',
})

export const projectListOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: privateCache,
    freshness: { kind: 'runtime-only' },
    identity: {
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetCorporationsProjectsListing',
})

export const projectDetailOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: privateCache,
    identity: {
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'projectId' },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetCorporationsProjectsDetail',
})

export const projectContributionOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: privateCache,
    identity: {
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'projectId' },
        { kind: 'scalar', field: 'characterId' },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetCorporationsProjectsContribution',
})

export const characterJobsOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: privateCache,
    identity: { fields: [{ kind: 'scalar', field: 'characterId' }], kind: 'mixed' },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetCharactersFreelanceJobsListing',
})

export const jobParticipationOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: privateCache,
    identity: {
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'jobId' },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetCharactersFreelanceJobsParticipation',
})

export const characterObjectivesOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: privateCache,
    identity: {
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetCharactersMilitaryCampaignsObjectivesListing',
})

export const objectiveParticipationOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    cache: privateCache,
    identity: {
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'objectiveId' },
      ],
      kind: 'mixed',
    },
    representationVersion: 'v1',
    retry: retry,
  },
  sdkOperationId: 'GetCharactersMilitaryCampaignsObjectivesParticipation',
})
