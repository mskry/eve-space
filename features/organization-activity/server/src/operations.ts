import { definePlatformExecutableEsiOperation } from '@eve-space/platform-module-server'

const audit = { reviewedDate: '2026-09-07' } as const
const retry = {
  kind: 'idempotent',
  attempts: 2,
  initialDelayMilliseconds: 250,
  maximumDelayMilliseconds: 1000,
} as const
const responseValidation = { kind: 'enabled' } as const

const sharedCache = {
  kind: 'shared',
  collapse: true,
  revalidate: true,
  stale: { kind: 'bounded', milliseconds: 3600000 },
  retentionMilliseconds: 86400000,
} as const

const privateCache = {
  kind: 'shared',
  collapse: true,
  revalidate: true,
  stale: { kind: 'outage', milliseconds: 3600000 },
  retentionMilliseconds: 86400000,
} as const

export const campaignListOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetMilitaryCampaignsListing',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: { kind: 'ordered', fields: [] },
    freshness: { kind: 'relative', seconds: 60 },
    cache: sharedCache,
    rateGroup: { kind: 'declared', group: 'military-campaign', maximumTokens: 300, window: '15m' },
    compatibility: { minimumDate: '2026-08-04' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const campaignDetailOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetMilitaryCampaignsDetail',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: { kind: 'mixed', fields: [{ kind: 'scalar', field: 'campaignId' }] },
    freshness: { kind: 'relative', seconds: 60 },
    cache: sharedCache,
    rateGroup: { kind: 'declared', group: 'military-campaign', maximumTokens: 300, window: '15m' },
    compatibility: { minimumDate: '2026-08-04' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const objectiveListOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetMilitaryCampaignsObjectivesListing',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'campaignId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
    },
    freshness: { kind: 'relative', seconds: 60 },
    cache: sharedCache,
    rateGroup: { kind: 'declared', group: 'military-campaign', maximumTokens: 300, window: '15m' },
    compatibility: { minimumDate: '2026-08-04' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const objectiveDetailOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetMilitaryCampaignsObjectivesDetail',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'campaignId' },
        { kind: 'scalar', field: 'objectiveId' },
      ],
    },
    freshness: { kind: 'relative', seconds: 60 },
    cache: sharedCache,
    rateGroup: { kind: 'declared', group: 'military-campaign', maximumTokens: 300, window: '15m' },
    compatibility: { minimumDate: '2026-08-04' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const jobListOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetFreelanceJobsListing',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
    },
    freshness: { kind: 'runtime-only' },
    cache: sharedCache,
    rateGroup: { kind: 'declared', group: 'freelance-job', maximumTokens: 12000, window: '15m' },
    compatibility: { minimumDate: '2025-12-16' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const jobDetailOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetFreelanceJobsDetail',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: { kind: 'mixed', fields: [{ kind: 'scalar', field: 'jobId' }] },
    freshness: { kind: 'relative', seconds: 60 },
    cache: sharedCache,
    rateGroup: { kind: 'declared', group: 'freelance-job', maximumTokens: 12000, window: '15m' },
    compatibility: { minimumDate: '2025-12-16' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const corporationJobsOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetCorporationsFreelanceJobsListing',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'character', scope: 'esi-corporations.read_freelance_jobs.v1' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
    },
    freshness: { kind: 'runtime-only' },
    cache: privateCache,
    rateGroup: { kind: 'declared', group: 'corp-freelance-job', maximumTokens: 300, window: '15m' },
    compatibility: { minimumDate: '2025-12-16' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const projectListOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetCorporationsProjectsListing',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'character', scope: 'esi-corporations.read_projects.v1' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
    },
    freshness: { kind: 'runtime-only' },
    cache: privateCache,
    rateGroup: { kind: 'declared', group: 'corp-project', maximumTokens: 600, window: '15m' },
    compatibility: { minimumDate: '2025-08-26' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const projectDetailOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetCorporationsProjectsDetail',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'character', scope: 'esi-corporations.read_projects.v1' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'projectId' },
      ],
    },
    freshness: { kind: 'relative', seconds: 60 },
    cache: privateCache,
    rateGroup: { kind: 'declared', group: 'corp-project', maximumTokens: 600, window: '15m' },
    compatibility: { minimumDate: '2025-08-26' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const projectContributionOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetCorporationsProjectsContribution',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'character', scope: 'esi-corporations.read_projects.v1' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'projectId' },
        { kind: 'scalar', field: 'characterId' },
      ],
    },
    freshness: { kind: 'relative', seconds: 60 },
    cache: privateCache,
    rateGroup: { kind: 'declared', group: 'corp-project', maximumTokens: 600, window: '15m' },
    compatibility: { minimumDate: '2025-08-26' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const characterJobsOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetCharactersFreelanceJobsListing',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'character', scope: 'esi-characters.read_freelance_jobs.v1' },
    identity: { kind: 'mixed', fields: [{ kind: 'scalar', field: 'characterId' }] },
    freshness: { kind: 'relative', seconds: 60 },
    cache: privateCache,
    rateGroup: { kind: 'declared', group: 'char-freelance-job', maximumTokens: 300, window: '15m' },
    compatibility: { minimumDate: '2025-12-16' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const jobParticipationOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetCharactersFreelanceJobsParticipation',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'character', scope: 'esi-characters.read_freelance_jobs.v1' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'jobId' },
      ],
    },
    freshness: { kind: 'relative', seconds: 60 },
    cache: privateCache,
    rateGroup: { kind: 'declared', group: 'char-freelance-job', maximumTokens: 300, window: '15m' },
    compatibility: { minimumDate: '2025-12-16' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const characterObjectivesOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetCharactersMilitaryCampaignsObjectivesListing',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'character', scope: 'esi.activity.char:read' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
    },
    freshness: { kind: 'relative', seconds: 60 },
    cache: privateCache,
    rateGroup: {
      kind: 'declared',
      group: 'char-military-campaign',
      maximumTokens: 150,
      window: '15m',
    },
    compatibility: { minimumDate: '2026-08-04' },
    retry: retry,
    responseValidation: responseValidation,
  },
})

export const objectiveParticipationOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetCharactersMilitaryCampaignsObjectivesParticipation',
  policy: {
    audit: audit,
    representationVersion: 'v1',
    authorization: { kind: 'character', scope: 'esi.activity.char:read' },
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'objectiveId' },
      ],
    },
    freshness: { kind: 'relative', seconds: 60 },
    cache: privateCache,
    rateGroup: {
      kind: 'declared',
      group: 'char-military-campaign',
      maximumTokens: 150,
      window: '15m',
    },
    compatibility: { minimumDate: '2026-08-04' },
    retry: retry,
    responseValidation: responseValidation,
  },
})
