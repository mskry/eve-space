import { installedModuleEsiOperationCatalog } from '../generated/platform/installed-module-esi.js'
import {
  defineContract,
  retry,
  sharedPrivateCache,
  sharedPublicCache,
  type EsiMutationContract,
  type EsiOperationContract,
} from './contract-types.js'

export const coreEsiOperationCatalog = {
  status: defineContract('status', {
    identity: { kind: 'ordered', fields: [] },
    cache: sharedPublicCache(),
    retry,
  }),
  'public-character': defineContract('public-character', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPublicCache(),
    retry,
  }),
  'public-corporation': defineContract('public-corporation', {
    representationVersion: 'v2',
    identity: { kind: 'ordered', fields: ['corporationId'] },
    cache: sharedPublicCache(),
    retry,
  }),
  'public-alliance': defineContract('public-alliance', {
    identity: { kind: 'ordered', fields: ['allianceId'] },
    cache: sharedPublicCache(),
    retry,
  }),
  'alliance-corporations': defineContract('alliance-corporations', {
    identity: { kind: 'ordered', fields: ['allianceId'] },
    cache: sharedPublicCache(),
    retry,
  }),
  'corporation-members': defineContract('corporation-members', {
    identity: { kind: 'ordered', fields: ['corporationId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'universe-races': defineContract('universe-races', {
    identity: { kind: 'ordered', fields: [] },
    cache: sharedPublicCache(),
    retry,
  }),
  'universe-bloodlines': defineContract('universe-bloodlines', {
    identity: { kind: 'ordered', fields: [] },
    cache: sharedPublicCache(),
    retry,
    responseValidation: {
      kind: 'disabled',
      reason: 'Live ship_type_id values may be null despite the SDK 3.0.1 schema.',
    },
  }),
  'character-assets-page': defineContract('character-assets-page', {
    identity: { kind: 'ordered', fields: ['characterId', 'page'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'character-asset-names': defineContract('character-asset-names', {
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'set', field: 'itemIds', maximumItems: 1_000 },
      ],
    },
    cache: sharedPrivateCache(),
    retry,
  }),
  'wallet-balance': defineContract('wallet-balance', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'wallet-journal': defineContract('wallet-journal', {
    identity: { kind: 'ordered', fields: ['characterId', 'page'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'wallet-transactions': defineContract('wallet-transactions', {
    representationVersion: 'v3',
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'scalar', field: 'fromId', nullable: true },
      ],
    },
    cache: sharedPrivateCache(),
    retry,
  }),
  'market-orders': defineContract('market-orders', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'market-order-history': defineContract('market-order-history', {
    identity: { kind: 'ordered', fields: ['characterId', 'page'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'character-contracts': defineContract('character-contracts', {
    identity: { kind: 'ordered', fields: ['characterId', 'page'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'character-contract-items': defineContract('character-contract-items', {
    identity: { kind: 'ordered', fields: ['characterId', 'contractId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'character-contract-bids': defineContract('character-contract-bids', {
    identity: { kind: 'ordered', fields: ['characterId', 'contractId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'mail-headers': defineContract('mail-headers', {
    identity: {
      kind: 'mixed',
      fields: [
        { kind: 'scalar', field: 'characterId' },
        { kind: 'set', field: 'labels', maximumItems: 25, nullable: true },
        { kind: 'scalar', field: 'lastMailId', nullable: true },
      ],
    },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: sharedPrivateCache(),
    retry,
  }),
  'mail-message': defineContract('mail-message', {
    identity: { kind: 'ordered', fields: ['characterId', 'mailId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: sharedPrivateCache(0),
    retry,
  }),
  'mail-labels': defineContract('mail-labels', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: sharedPrivateCache(),
    retry,
  }),
  'mail-lists': defineContract('mail-lists', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: sharedPrivateCache(),
    retry,
  }),
  'mail-send': defineContract('mail-send', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: { kind: 'none' },
    mutation: { kind: 'character', appliedOnMissing: false },
    retry: { kind: 'none' },
  }),
  'mail-create-label': defineContract('mail-create-label', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: { kind: 'none' },
    mutation: { kind: 'character', appliedOnMissing: false },
    retry: { kind: 'none' },
  }),
  'mail-update': defineContract('mail-update', {
    identity: { kind: 'ordered', fields: ['characterId', 'mailId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: { kind: 'none' },
    mutation: { kind: 'character', appliedOnMissing: false },
    retry,
  }),
  'mail-delete': defineContract('mail-delete', {
    identity: { kind: 'ordered', fields: ['characterId', 'mailId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: { kind: 'none' },
    mutation: { kind: 'character', appliedOnMissing: true },
    retry,
  }),
  'mail-delete-label': defineContract('mail-delete-label', {
    identity: { kind: 'ordered', fields: ['characterId', 'labelId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: { kind: 'none' },
    mutation: { kind: 'character', appliedOnMissing: true },
    retry,
  }),
  'character-search': defineContract('character-search', {
    identity: { kind: 'ordered', fields: ['characterId', 'search'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'character-cspa-charge': defineContract('character-cspa-charge', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: { kind: 'none' },
    retry,
  }),
  'character-corporation-roles': defineContract('character-corporation-roles', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  attributes: defineContract('attributes', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'skill-queue': defineContract('skill-queue', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'character-clones': defineContract('character-clones', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'character-implants': defineContract('character-implants', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  skills: defineContract('skills', {
    representationVersion: 'v2',
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  location: defineContract('location', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  ship: defineContract('ship', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'employment-history': defineContract('employment-history', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPublicCache(),
    retry,
  }),
  'universe-resolve-names': defineContract('universe-resolve-names', {
    identity: { kind: 'set', field: 'ids' },
    // ESI documents no cache lifetime for this route, but resolved names are only ever embedded in
    // hour- and day-lived DTOs, so a shorter fallback would cost requests without reducing staleness.
    freshness: { kind: 'relative', seconds: 3_600 },
    cache: sharedPublicCache(),
    retry,
  }),
  'universe-resolve-ids': defineContract('universe-resolve-ids', {
    identity: { kind: 'set', field: 'names' },
    freshness: { kind: 'relative', seconds: 3_600 },
    cache: sharedPublicCache(),
    retry,
  }),
  'corporation-alliance-history': defineContract('corporation-alliance-history', {
    identity: { kind: 'ordered', fields: ['corporationId'] },
    cache: sharedPublicCache(),
    retry,
  }),
  'corporation-npc-list': defineContract('corporation-npc-list', {
    identity: { kind: 'ordered', fields: [] },
    cache: sharedPublicCache(),
    retry,
  }),
  'universe-solar-system': defineContract('universe-solar-system', {
    identity: { kind: 'ordered', fields: ['systemId'] },
    cache: sharedPublicCache(),
    retry,
  }),
  'universe-station': defineContract('universe-station', {
    identity: { kind: 'ordered', fields: ['stationId'] },
    cache: sharedPublicCache(),
    retry,
  }),
  'universe-type': defineContract('universe-type', {
    identity: { kind: 'ordered', fields: ['typeId'] },
    cache: sharedPublicCache(),
    retry,
  }),
  'bulk-affiliation': defineContract('bulk-affiliation', {
    identity: { kind: 'set', field: 'characterIds' },
    freshness: { kind: 'none' },
    cache: { kind: 'none' },
    retry: { kind: 'none' },
  }),
} as const satisfies Record<string, EsiOperationContract>

export const esiOperationCatalog = {
  ...coreEsiOperationCatalog,
  ...installedModuleEsiOperationCatalog,
} as const satisfies Record<string, EsiOperationContract>

export type EsiOperation = keyof typeof esiOperationCatalog
export type CharacterMutationEsiOperation = {
  [Operation in EsiOperation]: (typeof esiOperationCatalog)[Operation] extends {
    mutation: EsiMutationContract
  }
    ? Operation
    : never
}[EsiOperation]
export const esiOperations = Object.keys(esiOperationCatalog) as EsiOperation[]
