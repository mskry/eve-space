import { definePlatformExecutableEsiOperation } from '@eve-space/platform-module-server'

const audit = { reviewedDate: '2026-09-07' } as const
const retry = {
  attempts: 2,
  initialDelayMilliseconds: 250,
  kind: 'idempotent',
  maximumDelayMilliseconds: 1000,
} as const
const responseValidation = { kind: 'enabled' } as const

const sharedCache = {
  collapse: true,
  kind: 'shared',
  retentionMilliseconds: 86_400_000,
  revalidate: true,
  stale: { kind: 'bounded', milliseconds: 3_600_000 },
} as const

const privateCache = {
  collapse: true,
  kind: 'shared',
  retentionMilliseconds: 86_400_000,
  revalidate: true,
  stale: { kind: 'outage', milliseconds: 3_600_000 },
} as const

export const campaignListOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'public' },
    cache: sharedCache,
    compatibility: { minimumDate: '2026-08-04' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: { fields: [], kind: 'ordered' },
    rateGroup: { group: 'military-campaign', kind: 'declared', maximumTokens: 300, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetMilitaryCampaignsListing',
})

export const campaignDetailOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'public' },
    cache: sharedCache,
    compatibility: { minimumDate: '2026-08-04' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: { fields: [{ kind: 'scalar', field: 'campaignId' }], kind: 'mixed' },
    rateGroup: { group: 'military-campaign', kind: 'declared', maximumTokens: 300, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetMilitaryCampaignsDetail',
})

export const objectiveListOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'public' },
    cache: sharedCache,
    compatibility: { minimumDate: '2026-08-04' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: {
      fields: [
        { kind: 'scalar', field: 'campaignId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
      kind: 'mixed',
    },
    rateGroup: { group: 'military-campaign', kind: 'declared', maximumTokens: 300, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetMilitaryCampaignsObjectivesListing',
})

export const objectiveDetailOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'public' },
    cache: sharedCache,
    compatibility: { minimumDate: '2026-08-04' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: {
      fields: [
        { kind: 'scalar', field: 'campaignId' },
        { kind: 'scalar', field: 'objectiveId' },
      ],
      kind: 'mixed',
    },
    rateGroup: { group: 'military-campaign', kind: 'declared', maximumTokens: 300, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetMilitaryCampaignsObjectivesDetail',
})

export const jobListOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'public' },
    cache: sharedCache,
    compatibility: { minimumDate: '2025-12-16' },
    freshness: { kind: 'runtime-only' },
    identity: {
      fields: [
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
      kind: 'mixed',
    },
    rateGroup: { group: 'freelance-job', kind: 'declared', maximumTokens: 12_000, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetFreelanceJobsListing',
})

export const jobDetailOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'public' },
    cache: sharedCache,
    compatibility: { minimumDate: '2025-12-16' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: { fields: [{ kind: 'scalar', field: 'jobId' }], kind: 'mixed' },
    rateGroup: { group: 'freelance-job', kind: 'declared', maximumTokens: 12_000, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetFreelanceJobsDetail',
})

export const corporationJobsOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'character', scope: 'esi-corporations.read_freelance_jobs.v1' },
    cache: privateCache,
    compatibility: { minimumDate: '2025-12-16' },
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
    rateGroup: { group: 'corp-freelance-job', kind: 'declared', maximumTokens: 300, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetCorporationsFreelanceJobsListing',
})

export const projectListOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'character', scope: 'esi-corporations.read_projects.v1' },
    cache: privateCache,
    compatibility: { minimumDate: '2025-08-26' },
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
    rateGroup: { group: 'corp-project', kind: 'declared', maximumTokens: 600, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetCorporationsProjectsListing',
})

export const projectDetailOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'character', scope: 'esi-corporations.read_projects.v1' },
    cache: privateCache,
    compatibility: { minimumDate: '2025-08-26' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: {
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'projectId' },
      ],
      kind: 'mixed',
    },
    rateGroup: { group: 'corp-project', kind: 'declared', maximumTokens: 600, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetCorporationsProjectsDetail',
})

export const projectContributionOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'character', scope: 'esi-corporations.read_projects.v1' },
    cache: privateCache,
    compatibility: { minimumDate: '2025-08-26' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: {
      fields: [
        { kind: 'scalar', field: 'corporationId' },
        { kind: 'scalar', field: 'projectId' },
        { kind: 'scalar', field: 'characterId' },
      ],
      kind: 'mixed',
    },
    rateGroup: { group: 'corp-project', kind: 'declared', maximumTokens: 600, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetCorporationsProjectsContribution',
})

export const characterJobsOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'character', scope: 'esi-characters.read_freelance_jobs.v1' },
    cache: privateCache,
    compatibility: { minimumDate: '2025-12-16' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: { fields: [{ kind: 'scalar', field: 'characterId' }], kind: 'mixed' },
    rateGroup: { group: 'char-freelance-job', kind: 'declared', maximumTokens: 300, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetCharactersFreelanceJobsListing',
})

export const jobParticipationOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'character', scope: 'esi-characters.read_freelance_jobs.v1' },
    cache: privateCache,
    compatibility: { minimumDate: '2025-12-16' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: {
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'jobId' },
      ],
      kind: 'mixed',
    },
    rateGroup: { group: 'char-freelance-job', kind: 'declared', maximumTokens: 300, window: '15m' },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetCharactersFreelanceJobsParticipation',
})

export const characterObjectivesOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'character', scope: 'esi.activity.char:read' },
    cache: privateCache,
    compatibility: { minimumDate: '2026-08-04' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: {
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'before', nullable: true },
        { kind: 'scalar', field: 'after', nullable: true },
        { kind: 'scalar', field: 'limit', nullable: true },
      ],
      kind: 'mixed',
    },
    rateGroup: {
      group: 'char-military-campaign',
      kind: 'declared',
      maximumTokens: 150,
      window: '15m',
    },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetCharactersMilitaryCampaignsObjectivesListing',
})

export const objectiveParticipationOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: audit,
    authorization: { kind: 'character', scope: 'esi.activity.char:read' },
    cache: privateCache,
    compatibility: { minimumDate: '2026-08-04' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: {
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'objectiveId' },
      ],
      kind: 'mixed',
    },
    rateGroup: {
      group: 'char-military-campaign',
      kind: 'declared',
      maximumTokens: 150,
      window: '15m',
    },
    representationVersion: 'v1',
    responseValidation: responseValidation,
    retry: retry,
  },
  sdkOperationId: 'GetCharactersMilitaryCampaignsObjectivesParticipation',
})
