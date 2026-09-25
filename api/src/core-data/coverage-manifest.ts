import type { CoreDataProductId } from '@eve-space/core-data-contract'

export const coreDataCoverageStatuses = [
  'implemented',
  'planned',
  'deferred',
  'unsupported',
] as const
export const coreDataCoverageExposures = ['internal', 'module-product'] as const
export const coreDataCoverageSources = [
  'official-sde',
  'esi-gateway',
  'domain-projection',
  'composed',
] as const

type CoreDataCoverageStatus = (typeof coreDataCoverageStatuses)[number]
type CoreDataCoverageExposure = (typeof coreDataCoverageExposures)[number]
type CoreDataCoverageSource = (typeof coreDataCoverageSources)[number]

export interface CoreDataCoverageEntry {
  domain: string
  capability: string
  owner: string
  source: CoreDataCoverageSource
  status: CoreDataCoverageStatus
  exposure?: CoreDataCoverageExposure
  rationale: string
  productId?: CoreDataProductId
  esiOperationIds?: readonly string[]
}

export const coreDataCoverageManifest = [
  entry(
    'characters',
    'assets',
    'characters',
    'esi-gateway',
    'implemented',
    'internal',
    'Character-owned canonical asset projection.',
    undefined,
    ['character-assets-page', 'character-asset-names'],
  ),
  entry(
    'characters',
    'contracts',
    'characters',
    'esi-gateway',
    'implemented',
    'internal',
    'Character-owned contract, item, and bid projections.',
    undefined,
    ['character-contracts', 'character-contract-items', 'character-contract-bids'],
  ),
  entry(
    'characters',
    'mail',
    'mail',
    'esi-gateway',
    'implemented',
    'internal',
    'Mailbox-owned reads and mutations.',
    undefined,
    [
      'mail-headers',
      'mail-message',
      'mail-labels',
      'mail-lists',
      'mail-send',
      'mail-create-label',
      'mail-update',
      'mail-delete',
      'mail-delete-label',
    ],
  ),
  entry(
    'characters',
    'market',
    'characters',
    'esi-gateway',
    'implemented',
    'internal',
    'Character-owned market order and history projections.',
    undefined,
    ['market-orders', 'market-order-history'],
  ),
  entry(
    'characters',
    'roles',
    'characters',
    'esi-gateway',
    'implemented',
    'internal',
    'Character-owned corporation-role projection.',
    undefined,
    ['character-corporation-roles'],
  ),
  entry(
    'characters',
    'skills',
    'characters',
    'esi-gateway',
    'implemented',
    'internal',
    'Character-owned skills and queue projections.',
    undefined,
    ['skills', 'skill-queue'],
  ),
  entry(
    'characters',
    'wallet',
    'characters',
    'esi-gateway',
    'implemented',
    'internal',
    'Character-owned balance, journal, and transaction projections.',
    undefined,
    ['wallet-balance', 'wallet-journal', 'wallet-transactions'],
  ),
  entry(
    'industry',
    'blueprints',
    'industry',
    'esi-gateway',
    'deferred',
    undefined,
    'Generated SDK availability has no application projection.',
  ),
  entry(
    'industry',
    'jobs',
    'industry',
    'esi-gateway',
    'deferred',
    undefined,
    'Generated SDK availability has no application projection.',
  ),
  entry(
    'industry',
    'materials',
    'industry',
    'official-sde',
    'deferred',
    undefined,
    'No reviewed reusable material projection exists.',
  ),
  entry(
    'social',
    'contacts',
    'characters',
    'esi-gateway',
    'planned',
    undefined,
    'Planned consumer work has not established a canonical projection.',
  ),
  entry(
    'universe',
    'entity-resolution',
    'universe',
    'esi-gateway',
    'implemented',
    'internal',
    'Universe name and ID resolution owns canonical per-item caching.',
    undefined,
    ['universe-resolve-names', 'universe-resolve-ids'],
  ),
  entry(
    'universe',
    'published-skill-catalogue',
    'core-data',
    'official-sde',
    'implemented',
    'module-product',
    'Bounded canonical skill catalogue for installed resource projection.',
    'published-skill-catalogue',
  ),
  entry(
    'universe',
    'published-type-details',
    'core-data',
    'official-sde',
    'implemented',
    'module-product',
    'Bounded published type, group, category, and volume projection.',
    'published-type-details',
  ),
  entry(
    'universe',
    'published-type-groups',
    'core-data',
    'official-sde',
    'implemented',
    'module-product',
    'Bounded static enrichment required by installed resources.',
    'published-type-groups',
  ),
  entry(
    'universe',
    'static-location-labels',
    'core-data',
    'official-sde',
    'implemented',
    'module-product',
    'Bounded offline solar-system and NPC-station labels for installed resources.',
    'static-location-labels',
  ),
  entry(
    'universe',
    'richer-relationships',
    'universe',
    'composed',
    'deferred',
    undefined,
    'No concrete cross-package consumer or intentional DTO is approved.',
  ),
  entry(
    'universe',
    'routing',
    'universe',
    'official-sde',
    'implemented',
    'internal',
    'Universe routing owns topology loading and route policy.',
  ),
  entry(
    'universe',
    'static-locations',
    'universe',
    'official-sde',
    'implemented',
    'internal',
    'Universe owns the committed solar-system and station snapshot.',
  ),
  entry(
    'universe',
    'type-details',
    'universe',
    'esi-gateway',
    'implemented',
    'internal',
    'Universe owns intentional type-detail mapping.',
    undefined,
    ['universe-type'],
  ),
] as const satisfies readonly CoreDataCoverageEntry[]

type CoreDataCoverageEntryValues = readonly [
  domain: string,
  capability: string,
  owner: string,
  source: CoreDataCoverageSource,
  status: CoreDataCoverageStatus,
  exposure: CoreDataCoverageExposure | undefined,
  rationale: string,
  productId?: CoreDataProductId,
  esiOperationIds?: readonly string[],
]

function entry(
  ...[
    domain,
    capability,
    owner,
    source,
    status,
    exposure,
    rationale,
    productId,
    esiOperationIds,
  ]: CoreDataCoverageEntryValues
): CoreDataCoverageEntry {
  return {
    domain,
    capability,
    owner,
    source,
    status,
    ...(exposure && { exposure }),
    rationale,
    ...(productId && { productId }),
    ...(esiOperationIds && { esiOperationIds }),
  }
}
