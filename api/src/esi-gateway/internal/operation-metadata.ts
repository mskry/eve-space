import { operationRegistry } from '@evespace/esi-client/operations'
import { defineMetadataReview, defineOperationMetadata } from './catalog-validation.js'

export const esiMetadataReview = defineMetadataReview({
  explorerUrl: 'https://developers.eveonline.com/api-explorer',
  requestedCompatibilityDate: '2026-08-23',
  resolvedCompatibilityDate: '2026-08-18',
  reviewedAt: '2026-09-03',
})

export const esiOperationMetadata = defineOperationMetadata({
  'alliance-corporations': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetAlliancesAllianceIdCorporations',
    minimumCompatibilityDate: '2020-01-01',
  },
  attributes: {
    cache: { kind: 'relative', seconds: 120 },
    esiOperationId: 'GetCharactersCharacterIdAttributes',
    minimumCompatibilityDate: '2020-01-01',
  },
  'bulk-affiliation': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'PostCharactersAffiliation',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-asset-names': {
    cache: { kind: 'runtime-only' },
    esiOperationId: 'PostCharactersCharacterIdAssetsNames',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-assets-page': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCharactersCharacterIdAssets',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-clones': {
    cache: { kind: 'relative', seconds: 120 },
    esiOperationId: 'GetCharactersCharacterIdClones',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-contract-bids': {
    cache: { kind: 'relative', seconds: 300 },
    esiOperationId: 'GetCharactersCharacterIdContractsContractIdBids',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-contract-items': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCharactersCharacterIdContractsContractIdItems',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-contracts': {
    cache: { kind: 'relative', seconds: 300 },
    esiOperationId: 'GetCharactersCharacterIdContracts',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-corporation-roles': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCharactersCharacterIdRoles',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-cspa-charge': {
    cache: { kind: 'none' },
    esiOperationId: 'PostCharactersCharacterIdCspa',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-implants': {
    cache: { kind: 'relative', seconds: 120 },
    esiOperationId: 'GetCharactersCharacterIdImplants',
    minimumCompatibilityDate: '2020-01-01',
  },
  'character-search': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCharactersCharacterIdSearch',
    minimumCompatibilityDate: '2020-01-01',
  },
  'corporation-alliance-history': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCorporationsCorporationIdAlliancehistory',
    minimumCompatibilityDate: '2020-01-01',
  },
  'corporation-members': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCorporationsCorporationIdMembers',
    minimumCompatibilityDate: '2020-01-01',
  },
  'corporation-npc-list': {
    cache: { hour: 11, kind: 'daily-utc', minute: 5 },
    esiOperationId: 'GetCorporationsNpccorps',
    minimumCompatibilityDate: '2020-01-01',
  },
  'employment-history': {
    cache: { kind: 'relative', seconds: 86_400 },
    esiOperationId: 'GetCharactersCharacterIdCorporationhistory',
    minimumCompatibilityDate: '2020-01-01',
  },
  location: {
    cache: { kind: 'relative', seconds: 5 },
    esiOperationId: 'GetCharactersCharacterIdLocation',
    minimumCompatibilityDate: '2020-01-01',
  },
  'mail-create-label': {
    cache: { kind: 'none' },
    esiOperationId: 'PostCharactersCharacterIdMailLabels',
    minimumCompatibilityDate: '2020-01-01',
  },
  'mail-delete': {
    cache: { kind: 'none' },
    esiOperationId: 'DeleteCharactersCharacterIdMailMailId',
    minimumCompatibilityDate: '2020-01-01',
  },
  'mail-delete-label': {
    cache: { kind: 'none' },
    esiOperationId: 'DeleteCharactersCharacterIdMailLabelsLabelId',
    minimumCompatibilityDate: '2020-01-01',
  },
  'mail-headers': {
    cache: { kind: 'relative', seconds: 30 },
    esiOperationId: 'GetCharactersCharacterIdMail',
    minimumCompatibilityDate: '2020-01-01',
  },
  'mail-labels': {
    cache: { kind: 'relative', seconds: 30 },
    esiOperationId: 'GetCharactersCharacterIdMailLabels',
    minimumCompatibilityDate: '2020-01-01',
  },
  'mail-lists': {
    cache: { kind: 'relative', seconds: 120 },
    esiOperationId: 'GetCharactersCharacterIdMailLists',
    minimumCompatibilityDate: '2020-01-01',
  },
  'mail-message': {
    cache: { kind: 'relative', seconds: 30 },
    esiOperationId: 'GetCharactersCharacterIdMailMailId',
    minimumCompatibilityDate: '2020-01-01',
  },
  'mail-send': {
    cache: { kind: 'none' },
    esiOperationId: 'PostCharactersCharacterIdMail',
    minimumCompatibilityDate: '2020-01-01',
  },
  'mail-update': {
    cache: { kind: 'none' },
    esiOperationId: 'PutCharactersCharacterIdMailMailId',
    minimumCompatibilityDate: '2020-01-01',
  },
  'market-order-history': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCharactersCharacterIdOrdersHistory',
    minimumCompatibilityDate: '2020-01-01',
  },
  'market-orders': {
    cache: { kind: 'relative', seconds: 1200 },
    esiOperationId: 'GetCharactersCharacterIdOrders',
    minimumCompatibilityDate: '2020-01-01',
  },
  'public-alliance': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetAlliancesAllianceId',
    minimumCompatibilityDate: '2020-01-01',
  },
  'public-character': {
    cache: { kind: 'relative', seconds: 86_400 },
    esiOperationId: 'GetCharactersDetail',
    minimumCompatibilityDate: '2026-06-09',
  },
  'public-corporation': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCorporationsCorporationId',
    minimumCompatibilityDate: '2026-07-21',
  },
  ship: {
    cache: { kind: 'relative', seconds: 5 },
    esiOperationId: 'GetCharactersCharacterIdShip',
    minimumCompatibilityDate: '2020-01-01',
  },
  'skill-queue': {
    cache: { kind: 'relative', seconds: 120 },
    esiOperationId: 'GetCharactersCharacterIdSkillqueue',
    minimumCompatibilityDate: '2020-01-01',
  },
  skills: {
    cache: { kind: 'relative', seconds: 60 },
    esiOperationId: 'GetCharactersCharacterIdSkills',
    minimumCompatibilityDate: '2020-01-01',
  },
  status: {
    cache: { kind: 'relative', seconds: 30 },
    esiOperationId: 'GetStatus',
    minimumCompatibilityDate: '2020-01-01',
  },
  'universe-bloodlines': {
    cache: { hour: 11, kind: 'daily-utc', minute: 5 },
    esiOperationId: 'GetUniverseBloodlines',
    minimumCompatibilityDate: '2020-01-01',
  },
  'universe-races': {
    cache: { hour: 11, kind: 'daily-utc', minute: 5 },
    esiOperationId: 'GetUniverseRaces',
    minimumCompatibilityDate: '2020-01-01',
  },
  'universe-resolve-ids': {
    cache: { kind: 'runtime-only' },
    esiOperationId: 'PostUniverseIds',
    minimumCompatibilityDate: '2020-01-01',
  },
  'universe-resolve-names': {
    cache: { kind: 'runtime-only' },
    esiOperationId: 'PostUniverseNames',
    minimumCompatibilityDate: '2020-01-01',
  },
  'universe-solar-system': {
    cache: { hour: 11, kind: 'daily-utc', minute: 5 },
    esiOperationId: 'GetUniverseSystemsSystemId',
    minimumCompatibilityDate: '2020-01-01',
  },
  'universe-station': {
    cache: { hour: 11, kind: 'daily-utc', minute: 5 },
    esiOperationId: 'GetUniverseStationsStationId',
    minimumCompatibilityDate: '2020-01-01',
  },
  'universe-type': {
    cache: { hour: 11, kind: 'daily-utc', minute: 5 },
    esiOperationId: 'GetUniverseTypesTypeId',
    minimumCompatibilityDate: '2020-01-01',
  },
  'wallet-balance': {
    cache: { kind: 'relative', seconds: 120 },
    esiOperationId: 'GetCharactersCharacterIdWallet',
    minimumCompatibilityDate: '2020-01-01',
  },
  'wallet-journal': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCharactersCharacterIdWalletJournal',
    minimumCompatibilityDate: '2020-01-01',
  },
  'wallet-transactions': {
    cache: { kind: 'relative', seconds: 3600 },
    esiOperationId: 'GetCharactersCharacterIdWalletTransactions',
    minimumCompatibilityDate: '2020-01-01',
  },
})

export const coreEsiOperationIds = Object.freeze(Object.keys(esiOperationMetadata))

export type CoreEsiOperation = keyof typeof esiOperationMetadata

export function getGeneratedEsiOperationFacts(operation: CoreEsiOperation) {
  const metadata = esiOperationMetadata[operation]
  const sdkOperation = operationRegistry[metadata.esiOperationId]
  const { transport } = sdkOperation

  return {
    authenticationScopes: transport.authentication?.scopes ?? [],
    classification: sdkOperation.classification,
    maximumBatchSize: transport.protocol.maximumBatchSize,
    method: transport.method,
    path: transport.path,
    rateLimit: transport.protocol.rateLimit,
    requestArrayLimits: transport.protocol.requestArrayLimits,
    supportsConditionalRequests: transport.protocol.conditionalRequestValidators.length > 0,
  }
}

export function getGeneratedEsiMaximumBatchSize(operation: CoreEsiOperation) {
  const maximumBatchSize = getGeneratedEsiOperationFacts(operation).maximumBatchSize
  if (maximumBatchSize === null) {
    throw new Error(`ESI operation ${operation} does not declare a generated batch limit`)
  }
  return maximumBatchSize
}
