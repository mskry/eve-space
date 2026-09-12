import { operationRegistry } from '@evespace/esi-client/operations'
import { defineMetadataReview, defineOperationMetadata } from './catalog-validation.js'

export const esiMetadataReview = defineMetadataReview({
  explorerUrl: 'https://developers.eveonline.com/api-explorer',
  reviewedAt: '2026-09-03',
  requestedCompatibilityDate: '2026-08-23',
  resolvedCompatibilityDate: '2026-08-18',
})

export const esiOperationMetadata = defineOperationMetadata({
  status: {
    esiOperationId: 'GetStatus',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 30 },
  },
  'public-character': {
    esiOperationId: 'GetCharactersDetail',
    minimumCompatibilityDate: '2026-06-09',
    cache: { kind: 'relative', seconds: 86_400 },
  },
  'public-corporation': {
    esiOperationId: 'GetCorporationsCorporationId',
    minimumCompatibilityDate: '2026-07-21',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'public-alliance': {
    esiOperationId: 'GetAlliancesAllianceId',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'alliance-corporations': {
    esiOperationId: 'GetAlliancesAllianceIdCorporations',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'corporation-members': {
    esiOperationId: 'GetCorporationsCorporationIdMembers',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'universe-races': {
    esiOperationId: 'GetUniverseRaces',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
  },
  'universe-bloodlines': {
    esiOperationId: 'GetUniverseBloodlines',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
  },
  'character-assets-page': {
    esiOperationId: 'GetCharactersCharacterIdAssets',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'character-asset-names': {
    esiOperationId: 'PostCharactersCharacterIdAssetsNames',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'runtime-only' },
  },
  'wallet-balance': {
    esiOperationId: 'GetCharactersCharacterIdWallet',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 120 },
  },
  'wallet-journal': {
    esiOperationId: 'GetCharactersCharacterIdWalletJournal',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'wallet-transactions': {
    esiOperationId: 'GetCharactersCharacterIdWalletTransactions',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'market-orders': {
    esiOperationId: 'GetCharactersCharacterIdOrders',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 1_200 },
  },
  'market-order-history': {
    esiOperationId: 'GetCharactersCharacterIdOrdersHistory',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'character-contracts': {
    esiOperationId: 'GetCharactersCharacterIdContracts',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 300 },
  },
  'character-contract-items': {
    esiOperationId: 'GetCharactersCharacterIdContractsContractIdItems',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'character-contract-bids': {
    esiOperationId: 'GetCharactersCharacterIdContractsContractIdBids',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 300 },
  },
  'mail-headers': {
    esiOperationId: 'GetCharactersCharacterIdMail',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 30 },
  },
  'mail-message': {
    esiOperationId: 'GetCharactersCharacterIdMailMailId',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 30 },
  },
  'mail-labels': {
    esiOperationId: 'GetCharactersCharacterIdMailLabels',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 30 },
  },
  'mail-lists': {
    esiOperationId: 'GetCharactersCharacterIdMailLists',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 120 },
  },
  'mail-send': {
    esiOperationId: 'PostCharactersCharacterIdMail',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'none' },
  },
  'mail-create-label': {
    esiOperationId: 'PostCharactersCharacterIdMailLabels',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'none' },
  },
  'mail-update': {
    esiOperationId: 'PutCharactersCharacterIdMailMailId',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'none' },
  },
  'mail-delete': {
    esiOperationId: 'DeleteCharactersCharacterIdMailMailId',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'none' },
  },
  'mail-delete-label': {
    esiOperationId: 'DeleteCharactersCharacterIdMailLabelsLabelId',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'none' },
  },
  'character-search': {
    esiOperationId: 'GetCharactersCharacterIdSearch',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'character-cspa-charge': {
    esiOperationId: 'PostCharactersCharacterIdCspa',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'none' },
  },
  'character-corporation-roles': {
    esiOperationId: 'GetCharactersCharacterIdRoles',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  attributes: {
    esiOperationId: 'GetCharactersCharacterIdAttributes',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 120 },
  },
  'skill-queue': {
    esiOperationId: 'GetCharactersCharacterIdSkillqueue',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 120 },
  },
  'character-clones': {
    esiOperationId: 'GetCharactersCharacterIdClones',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 120 },
  },
  'character-implants': {
    esiOperationId: 'GetCharactersCharacterIdImplants',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 120 },
  },
  skills: {
    esiOperationId: 'GetCharactersCharacterIdSkills',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 60 },
  },
  location: {
    esiOperationId: 'GetCharactersCharacterIdLocation',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 5 },
  },
  ship: {
    esiOperationId: 'GetCharactersCharacterIdShip',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 5 },
  },
  'employment-history': {
    esiOperationId: 'GetCharactersCharacterIdCorporationhistory',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 86_400 },
  },
  'universe-resolve-names': {
    esiOperationId: 'PostUniverseNames',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'runtime-only' },
  },
  'universe-resolve-ids': {
    esiOperationId: 'PostUniverseIds',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'runtime-only' },
  },
  'corporation-alliance-history': {
    esiOperationId: 'GetCorporationsCorporationIdAlliancehistory',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
  'corporation-npc-list': {
    esiOperationId: 'GetCorporationsNpccorps',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
  },
  'universe-solar-system': {
    esiOperationId: 'GetUniverseSystemsSystemId',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
  },
  'universe-station': {
    esiOperationId: 'GetUniverseStationsStationId',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
  },
  'universe-type': {
    esiOperationId: 'GetUniverseTypesTypeId',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'daily-utc', hour: 11, minute: 5 },
  },
  'bulk-affiliation': {
    esiOperationId: 'PostCharactersAffiliation',
    minimumCompatibilityDate: '2020-01-01',
    cache: { kind: 'relative', seconds: 3_600 },
  },
})

export const coreEsiOperationIds = Object.freeze(Object.keys(esiOperationMetadata))

export type CoreEsiOperation = keyof typeof esiOperationMetadata

export function getGeneratedEsiOperationFacts(operation: CoreEsiOperation) {
  const metadata = esiOperationMetadata[operation]
  const sdkOperation = operationRegistry[metadata.esiOperationId]
  const { transport } = sdkOperation

  return {
    classification: sdkOperation.classification,
    method: transport.method,
    path: transport.path,
    authenticationScopes: transport.authentication?.scopes ?? [],
    supportsConditionalRequests: transport.protocol.conditionalRequestValidators.length > 0,
    rateLimit: transport.protocol.rateLimit,
    requestArrayLimits: transport.protocol.requestArrayLimits,
    maximumBatchSize: transport.protocol.maximumBatchSize,
  }
}

export function getGeneratedEsiMaximumBatchSize(operation: CoreEsiOperation) {
  const maximumBatchSize = getGeneratedEsiOperationFacts(operation).maximumBatchSize
  if (maximumBatchSize === null)
    throw new Error(`ESI operation ${operation} does not declare a generated batch limit`)
  return maximumBatchSize
}
