import type {
  PlatformEsiFreshnessContract,
  PlatformEsiOperationContract,
  PlatformEsiResponseValidationContract,
  PlatformEsiRetryContract,
} from '@eve-space/platform-module-contract'
import {
  installedModuleEsiOperationCatalog,
  installedModuleEsiOperationDefinitions,
  installedModuleEsiSdkOperationIds,
} from '../generated/platform/installed-module-esi.js'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import { operationRegistry } from '@evespace/esi-client/operations'
import { assertEsiOperationContracts, isIsoCalendarDate } from './catalog-validation.js'
import { esiMetadataReview, esiOperationMetadata } from './operation-metadata.js'

type EsiIdentityContract =
  | { kind: 'ordered'; fields: readonly string[] }
  | { kind: 'set'; field: string; maximumItems: number }
  | {
      kind: 'mixed'
      fields: readonly (
        | { kind: 'scalar'; field: string; nullable?: boolean }
        | { kind: 'set'; field: string; maximumItems: number; nullable?: boolean }
      )[]
    }

type EsiIdentityConfiguration =
  | Extract<EsiIdentityContract, { kind: 'ordered' | 'mixed' }>
  | { kind: 'set'; field: string }

export interface EsiResourceRevisionContract {
  readonly kind: 'character'
  readonly namespace: string
}

export type EsiFreshnessContract = PlatformEsiFreshnessContract

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

export type EsiRetryContract = PlatformEsiRetryContract
export type EsiResponseValidationContract = PlatformEsiResponseValidationContract
export type EsiOperationContract = Omit<PlatformEsiOperationContract, 'identity'> & {
  readonly identity: EsiIdentityContract
  readonly resourceRevision?: EsiResourceRevisionContract
}

type ResolvedCoreEsiOperationContract<
  Operation extends keyof typeof esiOperationMetadata,
  Identity extends EsiIdentityContract = EsiIdentityContract,
> = Omit<EsiOperationContract, 'authorization' | 'identity' | 'rateGroup'> & {
  readonly identity: Identity
  readonly authorization: (typeof esiOperationMetadata)[Operation]['requiredScope'] extends infer Scope extends
    string
    ? { readonly kind: 'character'; readonly scope: Scope }
    : { readonly kind: 'public' }
  readonly rateGroup: (typeof esiOperationMetadata)[Operation]['rateLimit'] extends {
    readonly kind: 'declared'
    readonly group: infer Group extends string
    readonly maximumTokens: infer MaximumTokens extends number
    readonly window: infer Window extends string
  }
    ? {
        readonly kind: 'declared'
        readonly group: Group
        readonly maximumTokens: MaximumTokens
        readonly window: Window
      }
    : { readonly kind: 'legacy-only' }
}

type ResolvedIdentity<Identity extends EsiIdentityConfiguration> = Identity extends {
  kind: 'set'
  field: infer Field extends string
}
  ? { kind: 'set'; field: Field; maximumItems: number }
  : Identity

const minute = 60_000
const hour = 60 * minute
const retry = {
  kind: 'idempotent',
  attempts: 3,
  initialDelayMilliseconds: 500,
  maximumDelayMilliseconds: 10_000,
} as const satisfies EsiRetryContract

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
    retry: { kind: 'none' },
  }),
  'mail-create-label': defineContract('mail-create-label', {
    identity: { kind: 'ordered', fields: ['characterId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: { kind: 'none' },
    retry: { kind: 'none' },
  }),
  'mail-update': defineContract('mail-update', {
    identity: { kind: 'ordered', fields: ['characterId', 'mailId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: { kind: 'none' },
    retry,
  }),
  'mail-delete': defineContract('mail-delete', {
    identity: { kind: 'ordered', fields: ['characterId', 'mailId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: { kind: 'none' },
    retry,
  }),
  'mail-delete-label': defineContract('mail-delete-label', {
    identity: { kind: 'ordered', fields: ['characterId', 'labelId'] },
    resourceRevision: { kind: 'character', namespace: 'mailbox' },
    cache: { kind: 'none' },
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

/** The character scope an operation requires, or null when it is a public operation. */
export function getOptionalCharacterEsiScope(operation: EsiOperation) {
  const authorization = getEsiOperationContract(operation).authorization
  return authorization.kind === 'character' ? authorization.scope : null
}

export function assertRegisteredEsiOperation(operation: string): asserts operation is EsiOperation {
  if (!Object.hasOwn(esiOperationCatalog, operation))
    throw new Error(`Unregistered ESI operation: ${operation}`)
}

export function getExecutableEsiOperationDefinition(
  operation: string,
  definitions: Readonly<
    Record<string, PlatformExecutableEsiOperationDefinition>
  > = installedModuleEsiOperationDefinitions,
) {
  const definition = definitions[operation]
  if (!definition) throw new Error(`ESI operation ${operation} has no executable definition`)
  return definition
}

export function assertEsiOperationCatalogConfiguration(
  options: {
    compatibilityDate: string
    ssoEnabled: boolean
    requestableScopes: readonly string[]
  },
  catalog: Readonly<Record<string, unknown>> = esiOperationCatalog,
  expectedSdkOperationIds: Readonly<Record<string, string>> = catalog === esiOperationCatalog
    ? installedModuleEsiSdkOperationIds
    : {},
) {
  assertEsiOperationContracts(catalog, expectedSdkOperationIds)
  if (catalog === esiOperationCatalog)
    assertExecutableEsiOperationDefinitions(
      installedModuleEsiOperationCatalog,
      installedModuleEsiOperationDefinitions,
    )
  if (!isIsoCalendarDate(options.compatibilityDate))
    throw new Error('ESI compatibility configuration date must use YYYY-MM-DD')

  const incompatible = Object.entries(catalog).flatMap(([operation, contract]) =>
    contract.compatibility.minimumDate > options.compatibilityDate
      ? [`${operation} requires ${contract.compatibility.minimumDate}`]
      : [],
  )
  if (incompatible.length > 0)
    throw new Error(
      `ESI compatibility configuration is too old: ${incompatible.toSorted((left, right) => left.localeCompare(right)).join(', ')}`,
    )

  if (!options.ssoEnabled) return
  const requestableScopes = new Set(options.requestableScopes)
  const missingScopes = new Set<string>()
  for (const contract of Object.values(catalog)) {
    if (
      contract.authorization.kind === 'character' &&
      !requestableScopes.has(contract.authorization.scope)
    )
      missingScopes.add(contract.authorization.scope)
  }
  if (missingScopes.size > 0)
    throw new Error(
      `EVE_SCOPES is missing scopes required by registered ESI operations: ${[...missingScopes].toSorted((left, right) => left.localeCompare(right)).join(' ')}`,
    )
}

export function assertExecutableEsiOperationDefinitions(
  catalog: Readonly<Record<string, PlatformEsiOperationContract>>,
  definitions: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  const issues: string[] = []
  const operationIds = new Set([...Object.keys(catalog), ...Object.keys(definitions)])
  for (const operation of operationIds) {
    const contract = catalog[operation]
    const definition = definitions[operation]
    if (!contract) {
      issues.push(`definition ${operation} has no catalog contract`)
      continue
    }
    if (!definition) {
      issues.push(`catalog operation ${operation} has no executable definition`)
      continue
    }
    if (definition.contract !== contract)
      issues.push(`operation ${operation} definition does not own its catalog contract`)
    if (definition.sdkOperationId !== contract.audit.esiOperationId)
      issues.push(
        `operation ${operation} definition binds ${definition.sdkOperationId} instead of ${contract.audit.esiOperationId}`,
      )
    if (operationRegistry[definition.sdkOperationId] !== definition.descriptor)
      issues.push(`operation ${operation} does not bind the registered SDK descriptor`)
  }
  if (issues.length > 0)
    throw new Error(
      `Invalid executable ESI operation definitions:\n${issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
}

function defineContract<
  Operation extends keyof typeof esiOperationMetadata,
  const Options extends {
    representationVersion?: string
    identity: EsiIdentityConfiguration
    freshness?: EsiFreshnessContract
    cache: EsiCacheConfiguration
    retry: EsiRetryContract
    responseValidation?: EsiResponseValidationContract
    resourceRevision?: EsiResourceRevisionContract
  },
>(
  operation: Operation,
  options: Options,
): ResolvedCoreEsiOperationContract<Operation, ResolvedIdentity<Options['identity']>> {
  const metadata = esiOperationMetadata[operation]
  const contract: EsiOperationContract = {
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
        ? {
            kind: 'declared',
            group: metadata.rateLimit.group,
            maximumTokens: metadata.rateLimit.maximumTokens,
            window: metadata.rateLimit.window,
          }
        : { kind: 'legacy-only' },
    retry: options.retry,
    compatibility: {
      minimumDate: metadata.minimumCompatibilityDate,
    },
    responseValidation: options.responseValidation ?? { kind: 'enabled' },
    resourceRevision: options.resourceRevision,
  }
  return contract as ResolvedCoreEsiOperationContract<
    Operation,
    ResolvedIdentity<Options['identity']>
  >
}

function sharedPublicCache(): EsiCacheConfiguration {
  return {
    kind: 'shared',
    collapse: true,
    stale: { kind: 'bounded', milliseconds: hour },
    retentionMilliseconds: hour,
  }
}

function sharedPrivateCache(retentionMilliseconds = hour): EsiCacheConfiguration {
  return {
    kind: 'shared',
    collapse: true,
    stale: { kind: 'none' },
    retentionMilliseconds,
  }
}

function resolveIdentity(
  identity: EsiIdentityConfiguration,
  metadata: (typeof esiOperationMetadata)[keyof typeof esiOperationMetadata],
): EsiIdentityContract {
  if (identity.kind === 'ordered') return identity
  if (identity.kind === 'mixed') {
    const setFields = identity.fields.filter((field) => field.kind === 'set')
    if (setFields.length === 0) return identity
    if (!('maximumBatchSize' in metadata))
      throw new Error('Mixed ESI identity is missing reviewed maximum batch metadata')
    if (setFields.some((field) => field.maximumItems !== metadata.maximumBatchSize))
      throw new Error('Mixed ESI identity maximum conflicts with reviewed batch metadata')
    return identity
  }
  if (!('maximumBatchSize' in metadata))
    throw new Error('Set-like ESI operation is missing reviewed maximum batch metadata')
  return { ...identity, maximumItems: metadata.maximumBatchSize }
}
