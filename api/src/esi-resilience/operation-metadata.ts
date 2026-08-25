export type DocumentedCacheBehavior =
  | { kind: 'relative'; seconds: number }
  | { kind: 'daily-utc'; hour: number; minute: number }
  | { kind: 'runtime-only' }

type DocumentedRateLimit =
  | { kind: 'legacy-only' }
  | { kind: 'declared'; group: string; maximumTokens: number; window: string }

interface EsiOperationMetadata {
  method: 'GET' | 'POST'
  path: string
  esiOperationId: string
  minimumCompatibilityDate: string
  requiredScope: string | null
  cache: DocumentedCacheBehavior
  supportsConditionalRequests: true
  rateLimit: DocumentedRateLimit
  maximumBatchSize?: number
}

export const esiMetadataReview = {
  explorerUrl: 'https://developers.eveonline.com/api-explorer',
  reviewedAt: '2026-08-25',
  requestedCompatibilityDate: '2026-08-23',
  resolvedCompatibilityDate: '2026-08-18',
} as const

export const esiOperationMetadata = {
  status: {
    method: 'GET',
    path: '/status',
    esiOperationId: 'GetStatus',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'relative', seconds: 30 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'declared', group: 'status', maximumTokens: 600, window: '15m' },
  },
  'public-character': {
    method: 'GET',
    path: '/characters/{character_id}',
    esiOperationId: 'GetCharactersDetail',
    minimumCompatibilityDate: '2026-06-09',
    requiredScope: null,
    cache: { kind: 'relative', seconds: 86_400 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'public-corporation': {
    method: 'GET',
    path: '/corporations/{corporation_id}',
    esiOperationId: 'GetCorporationsCorporationId',
    minimumCompatibilityDate: '2026-07-21',
    requiredScope: null,
    cache: { kind: 'relative', seconds: 3_600 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'public-alliance': {
    method: 'GET',
    path: '/alliances/{alliance_id}',
    esiOperationId: 'GetAlliancesAllianceId',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'relative', seconds: 3_600 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'universe-races': {
    method: 'GET',
    path: '/universe/races',
    esiOperationId: 'GetUniverseRaces',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'universe-bloodlines': {
    method: 'GET',
    path: '/universe/bloodlines',
    esiOperationId: 'GetUniverseBloodlines',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'wallet-balance': {
    method: 'GET',
    path: '/characters/{character_id}/wallet',
    esiOperationId: 'GetCharactersCharacterIdWallet',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: 'esi-wallet.read_character_wallet.v1',
    cache: { kind: 'relative', seconds: 120 },
    supportsConditionalRequests: true,
    rateLimit: {
      kind: 'declared',
      group: 'char-wallet',
      maximumTokens: 150,
      window: '15m',
    },
  },
  'wallet-transactions': {
    method: 'GET',
    path: '/characters/{character_id}/wallet/transactions',
    esiOperationId: 'GetCharactersCharacterIdWalletTransactions',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: 'esi-wallet.read_character_wallet.v1',
    cache: { kind: 'relative', seconds: 3_600 },
    supportsConditionalRequests: true,
    rateLimit: {
      kind: 'declared',
      group: 'char-wallet',
      maximumTokens: 150,
      window: '15m',
    },
  },
  skills: {
    method: 'GET',
    path: '/characters/{character_id}/skills',
    esiOperationId: 'GetCharactersCharacterIdSkills',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: 'esi-skills.read_skills.v1',
    cache: { kind: 'relative', seconds: 60 },
    supportsConditionalRequests: true,
    rateLimit: {
      kind: 'declared',
      group: 'char-detail',
      maximumTokens: 600,
      window: '15m',
    },
  },
  location: {
    method: 'GET',
    path: '/characters/{character_id}/location',
    esiOperationId: 'GetCharactersCharacterIdLocation',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: 'esi-location.read_location.v1',
    cache: { kind: 'relative', seconds: 5 },
    supportsConditionalRequests: true,
    rateLimit: {
      kind: 'declared',
      group: 'char-location',
      maximumTokens: 1_200,
      window: '15m',
    },
  },
  ship: {
    method: 'GET',
    path: '/characters/{character_id}/ship',
    esiOperationId: 'GetCharactersCharacterIdShip',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: 'esi-location.read_ship_type.v1',
    cache: { kind: 'relative', seconds: 5 },
    supportsConditionalRequests: true,
    rateLimit: {
      kind: 'declared',
      group: 'char-location',
      maximumTokens: 1_200,
      window: '15m',
    },
  },
  'employment-history': {
    method: 'GET',
    path: '/characters/{character_id}/corporationhistory',
    esiOperationId: 'GetCharactersCharacterIdCorporationhistory',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'relative', seconds: 86_400 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'universe-resolve-names': {
    method: 'POST',
    path: '/universe/names',
    esiOperationId: 'PostUniverseNames',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'runtime-only' },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
    maximumBatchSize: 1_000,
  },
  'corporation-alliance-history': {
    method: 'GET',
    path: '/corporations/{corporation_id}/alliancehistory',
    esiOperationId: 'GetCorporationsCorporationIdAlliancehistory',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'relative', seconds: 3_600 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'corporation-npc-list': {
    method: 'GET',
    path: '/corporations/npccorps',
    esiOperationId: 'GetCorporationsNpccorps',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'universe-solar-system': {
    method: 'GET',
    path: '/universe/systems/{system_id}',
    esiOperationId: 'GetUniverseSystemsSystemId',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'universe-station': {
    method: 'GET',
    path: '/universe/stations/{station_id}',
    esiOperationId: 'GetUniverseStationsStationId',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'universe-type': {
    method: 'GET',
    path: '/universe/types/{type_id}',
    esiOperationId: 'GetUniverseTypesTypeId',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
  },
  'bulk-affiliation': {
    method: 'POST',
    path: '/characters/affiliation',
    esiOperationId: 'PostCharactersAffiliation',
    minimumCompatibilityDate: '2020-01-01',
    requiredScope: null,
    cache: { kind: 'relative', seconds: 3_600 },
    supportsConditionalRequests: true,
    rateLimit: { kind: 'legacy-only' },
    maximumBatchSize: 1_000,
  },
} as const satisfies Record<string, EsiOperationMetadata>
