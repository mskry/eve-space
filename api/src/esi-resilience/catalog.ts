import {
  esiMetadataReview,
  esiOperationMetadata,
  type DocumentedCacheBehavior,
} from './operation-metadata.js'

type EsiAuthorizationContract = { kind: 'public' } | { kind: 'character'; scope: string }

type EsiIdentityContract =
  | { kind: 'ordered'; fields: readonly string[] }
  | { kind: 'set'; field: string; maximumItems: number }

type EsiIdentityConfiguration =
  | { kind: 'ordered'; fields: readonly string[] }
  | { kind: 'set'; field: string }

export type EsiFreshnessContract = DocumentedCacheBehavior | { kind: 'none' }

type EsiCacheContract =
  | {
      kind: 'shared'
      collapse: boolean
      revalidate: boolean
      stale: { kind: 'bounded'; milliseconds: number } | { kind: 'none' }
      retentionMilliseconds: number
    }
  | { kind: 'none' }

type EsiCacheConfiguration =
  | Omit<Extract<EsiCacheContract, { kind: 'shared' }>, 'revalidate'>
  | { kind: 'none' }

type EsiRateGroupContract = { kind: 'legacy-only' } | { kind: 'declared'; group: string }

export type EsiRetryContract =
  | { kind: 'none' }
  | {
      kind: 'idempotent'
      attempts: number
      initialDelayMilliseconds: number
      maximumDelayMilliseconds: number
    }

export type EsiResponseValidationContract =
  | { kind: 'enabled' }
  | { kind: 'disabled'; reason: string }

export interface EsiOperationContract {
  audit: {
    esiOperationId: string
    reviewedDate: string
  }
  representationVersion: string
  authorization: EsiAuthorizationContract
  identity: EsiIdentityContract
  freshness: EsiFreshnessContract
  cache: EsiCacheContract
  rateGroup: EsiRateGroupContract
  retry: EsiRetryContract
  compatibility: {
    minimumDate: string
  }
  responseValidation: EsiResponseValidationContract
}

const minute = 60_000
const hour = 60 * minute
const retry = {
  kind: 'idempotent',
  attempts: 3,
  initialDelayMilliseconds: 500,
  maximumDelayMilliseconds: 10_000,
} as const satisfies EsiRetryContract

export const esiOperationCatalog = {
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
      reason: 'Live ship_type_id values may be null despite the SDK 2.0.0 schema.',
    },
  }),
  'wallet-balance': defineContract('wallet-balance', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  'wallet-transactions': defineContract('wallet-transactions', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    cache: sharedPrivateCache(),
    retry,
  }),
  skills: defineContract('skills', {
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

export type EsiOperation = keyof typeof esiOperationCatalog
export const esiOperations = Object.keys(esiOperationCatalog) as EsiOperation[]

export function getEsiOperationContract<Operation extends EsiOperation>(operation: Operation) {
  return esiOperationCatalog[operation]
}

export function getCharacterEsiScope(operation: EsiOperation) {
  const authorization = getEsiOperationContract(operation).authorization
  if (authorization.kind !== 'character')
    throw new Error(`ESI operation ${operation} does not declare character authorization`)
  return authorization.scope
}

export function assertRegisteredEsiOperation(operation: string): asserts operation is EsiOperation {
  if (!(operation in esiOperationCatalog))
    throw new Error(`Unregistered ESI operation: ${operation}`)
}

export function assertEsiOperationCatalogConfiguration(options: {
  compatibilityDate: string
  ssoEnabled: boolean
  requestableScopes: readonly string[]
}) {
  const incompatible = Object.entries(esiOperationCatalog).flatMap(([operation, contract]) =>
    contract.compatibility.minimumDate > options.compatibilityDate
      ? [`${operation} requires ${contract.compatibility.minimumDate}`]
      : [],
  )
  if (incompatible.length > 0)
    throw new Error(
      `ESI compatibility configuration is too old: ${incompatible.toSorted().join(', ')}`,
    )

  if (!options.ssoEnabled) return
  const requestableScopes = new Set(options.requestableScopes)
  const missingScopes = new Set<string>()
  for (const contract of Object.values(esiOperationCatalog)) {
    if (
      contract.authorization.kind === 'character' &&
      !requestableScopes.has(contract.authorization.scope)
    )
      missingScopes.add(contract.authorization.scope)
  }
  if (missingScopes.size > 0)
    throw new Error(
      `EVE_SCOPES is missing scopes required by active ESI operations: ${[...missingScopes].toSorted().join(' ')}`,
    )
}

function defineContract<Operation extends keyof typeof esiOperationMetadata>(
  operation: Operation,
  options: {
    representationVersion?: string
    identity: EsiIdentityConfiguration
    freshness?: EsiFreshnessContract
    cache: EsiCacheConfiguration
    retry: EsiRetryContract
    responseValidation?: EsiResponseValidationContract
  },
): EsiOperationContract {
  const metadata = esiOperationMetadata[operation]
  return {
    audit: {
      esiOperationId: metadata.esiOperationId,
      reviewedDate: esiMetadataReview.resolvedCompatibilityDate,
    },
    representationVersion: options.representationVersion ?? 'v1',
    authorization: metadata.requiredScope
      ? { kind: 'character', scope: metadata.requiredScope }
      : { kind: 'public' },
    identity: resolveIdentity(options.identity, metadata),
    freshness: options.freshness ?? metadata.cache,
    cache:
      options.cache.kind === 'shared'
        ? { ...options.cache, revalidate: metadata.supportsConditionalRequests }
        : options.cache,
    rateGroup:
      metadata.rateLimit.kind === 'declared'
        ? { kind: 'declared', group: metadata.rateLimit.group }
        : { kind: 'legacy-only' },
    retry: options.retry,
    compatibility: {
      minimumDate: metadata.minimumCompatibilityDate,
    },
    responseValidation: options.responseValidation ?? { kind: 'enabled' },
  }
}

function sharedPublicCache(): EsiCacheConfiguration {
  return {
    kind: 'shared',
    collapse: true,
    stale: { kind: 'bounded', milliseconds: hour },
    retentionMilliseconds: hour,
  }
}

function sharedPrivateCache(): EsiCacheConfiguration {
  return {
    kind: 'shared',
    collapse: true,
    stale: { kind: 'none' },
    retentionMilliseconds: hour,
  }
}

function resolveIdentity(
  identity: EsiIdentityConfiguration,
  metadata: (typeof esiOperationMetadata)[keyof typeof esiOperationMetadata],
): EsiIdentityContract {
  if (identity.kind === 'ordered') return identity
  if (!('maximumBatchSize' in metadata))
    throw new Error('Set-like ESI operation is missing reviewed maximum batch metadata')
  return { ...identity, maximumItems: metadata.maximumBatchSize }
}
