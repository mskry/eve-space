import type {
  PlatformEsiFreshnessContract,
  PlatformEsiIdentityContract,
  PlatformEsiOperationContract,
  PlatformEsiResponseValidationContract,
  PlatformEsiRetryContract,
} from '@eve-space/platform-module-contract'
import {
  esiMetadataReview,
  esiOperationMetadata,
  getGeneratedEsiOperationFacts,
} from './operation-metadata.js'

type EsiIdentityContract = PlatformEsiIdentityContract

type EsiMixedIdentityFieldConfiguration =
  | { readonly kind: 'scalar'; readonly field: string; readonly nullable?: boolean }
  | { readonly kind: 'set'; readonly field: string; readonly nullable?: boolean }

type EsiIdentityConfiguration =
  | Extract<EsiIdentityContract, { kind: 'ordered' }>
  | { readonly kind: 'mixed'; readonly fields: readonly EsiMixedIdentityFieldConfiguration[] }
  | { readonly kind: 'set'; readonly field: string }

export interface EsiResourceRevisionContract {
  readonly kind: 'character'
  readonly namespace: string
}

export interface EsiMutationContract {
  readonly kind: 'character'
  /**
   * Whether a 404 means the target already reached the requested state. Such a response still
   * changed nothing upstream, but the local representation may already be behind, so the resource
   * revision has to advance exactly as it would after a success.
   */
  readonly appliedOnMissing: boolean
}

export type EsiFreshnessContract = PlatformEsiFreshnessContract

type EsiCacheContract =
  | {
      kind: 'shared'
      collapse: boolean
      revalidate: boolean
      stale:
        | { kind: 'bounded'; milliseconds: number }
        | { kind: 'outage'; milliseconds: number }
        | { kind: 'none' }
      retentionMilliseconds: number
      runtimeRetention?: 'private'
    }
  | { kind: 'none' }

type EsiCacheConfiguration =
  | Omit<Extract<EsiCacheContract, { kind: 'shared' }>, 'revalidate'>
  | { kind: 'none' }

export type EsiRetryContract = PlatformEsiRetryContract
export type EsiResponseValidationContract = PlatformEsiResponseValidationContract
export type EsiOperationContract = Omit<PlatformEsiOperationContract, 'cache' | 'identity'> & {
  readonly cache: EsiCacheContract
  readonly identity: EsiIdentityContract
  readonly resourceRevision?: EsiResourceRevisionContract
  readonly mutation?: EsiMutationContract
}

/**
 * The catalog's derived operation unions read `cache` and `mutation` off each entry, so those
 * discriminants must survive `defineContract` as literals rather than collapsing to their unions.
 */
export type ResolvedCoreEsiOperationContract<
  Identity extends EsiIdentityContract = EsiIdentityContract,
  Cache extends EsiCacheContract = EsiCacheContract,
  Mutation extends EsiMutationContract | undefined = EsiMutationContract | undefined,
> = Omit<
  EsiOperationContract,
  'authorization' | 'identity' | 'rateGroup' | 'cache' | 'mutation'
> & {
  readonly identity: Identity
  readonly cache: Cache
  readonly mutation: Mutation
  readonly authorization: EsiOperationContract['authorization']
  readonly rateGroup: EsiOperationContract['rateGroup']
}

export type ResolvedIdentity<Identity extends EsiIdentityConfiguration> = Identity extends {
  kind: 'set'
  field: infer Field extends string
}
  ? { kind: 'set'; field: Field; maximumItems: number }
  : Identity extends {
        kind: 'mixed'
      }
    ? Extract<EsiIdentityContract, { kind: 'mixed' }>
    : Identity

export type ResolvedCache<Cache extends EsiCacheConfiguration> = Cache extends { kind: 'none' }
  ? { kind: 'none' }
  : Extract<EsiCacheContract, { kind: 'shared' }>

export type ResolvedMutation<Options> = Options extends {
  mutation: infer Mutation extends EsiMutationContract
}
  ? Mutation
  : undefined

const hour = 60 * 60_000

export const retry = {
  kind: 'idempotent',
  attempts: 3,
  initialDelayMilliseconds: 500,
  maximumDelayMilliseconds: 10_000,
} as const satisfies EsiRetryContract

export function defineContract<
  Operation extends keyof typeof esiOperationMetadata,
  const Options extends {
    representationVersion?: string
    identity: EsiIdentityConfiguration
    freshness?: EsiFreshnessContract
    cache: EsiCacheConfiguration
    retry: EsiRetryContract
    responseValidation?: EsiResponseValidationContract
    resourceRevision?: EsiResourceRevisionContract
    mutation?: EsiMutationContract
  },
>(
  operation: Operation,
  options: Options,
): ResolvedCoreEsiOperationContract<
  ResolvedIdentity<Options['identity']>,
  ResolvedCache<Options['cache']>,
  ResolvedMutation<Options>
> {
  const metadata = esiOperationMetadata[operation]
  const generated = getGeneratedEsiOperationFacts(operation)
  const expectedClassification = options.mutation ? 'mutation' : 'read'
  if (generated.classification !== expectedClassification)
    throw new Error(
      `ESI operation ${operation} is classified as ${generated.classification} by the SDK but configured as ${expectedClassification}`,
    )
  const contract: EsiOperationContract = {
    audit: {
      esiOperationId: metadata.esiOperationId,
      reviewedDate: esiMetadataReview.resolvedCompatibilityDate,
    },
    representationVersion: options.representationVersion ?? 'v1',
    authorization: resolveAuthorization(operation, generated.authenticationScopes),
    identity: resolveIdentity(
      operation,
      options.identity,
      generated.requestArrayLimits,
      generated.maximumBatchSize,
    ),
    freshness: options.freshness ?? metadata.cache,
    cache:
      options.cache.kind === 'shared'
        ? { ...options.cache, revalidate: generated.supportsConditionalRequests }
        : options.cache,
    rateGroup: generated.rateLimit,
    retry: options.retry,
    compatibility: {
      minimumDate: metadata.minimumCompatibilityDate,
    },
    responseValidation: options.responseValidation ?? { kind: 'enabled' },
    resourceRevision: options.resourceRevision,
    mutation: options.mutation,
  }
  return contract as ResolvedCoreEsiOperationContract<
    ResolvedIdentity<Options['identity']>,
    ResolvedCache<Options['cache']>,
    ResolvedMutation<Options>
  >
}

export function sharedPublicCache(): EsiCacheConfiguration {
  return {
    kind: 'shared',
    collapse: true,
    stale: { kind: 'bounded', milliseconds: hour },
    retentionMilliseconds: hour,
  }
}

export function sharedPrivateCache(retentionMilliseconds?: number): EsiCacheConfiguration {
  if (retentionMilliseconds === undefined)
    return {
      kind: 'shared',
      collapse: true,
      stale: { kind: 'none' },
      retentionMilliseconds: 0,
      runtimeRetention: 'private',
    }
  return {
    kind: 'shared',
    collapse: true,
    // Private DTOs stay fresh-only in normal operation. The retained envelope is released only
    // while ESI itself is unreachable, when upstream cannot contradict it and the alternative is
    // failing a request whose answer is already generation-bound to this character and token.
    stale:
      retentionMilliseconds > 0
        ? { kind: 'outage', milliseconds: retentionMilliseconds }
        : { kind: 'none' },
    retentionMilliseconds,
  }
}

function resolveIdentity(
  operation: keyof typeof esiOperationMetadata,
  identity: EsiIdentityConfiguration,
  requestArrayLimits: readonly { readonly maximumItems: number }[],
  maximumBatchSize: number | null,
): EsiIdentityContract {
  if (identity.kind === 'ordered') return identity
  if (identity.kind === 'mixed') {
    const setFields = identity.fields.filter((field) => field.kind === 'set')
    if (setFields.length === 0) return identity as EsiIdentityContract
    if (setFields.length !== requestArrayLimits.length)
      throw new Error(`Mixed ESI identity for ${operation} does not match generated array limits`)
    let limitIndex = 0
    return {
      ...identity,
      fields: identity.fields.map((field) =>
        field.kind === 'set'
          ? { ...field, maximumItems: requestArrayLimits[limitIndex++]!.maximumItems }
          : field,
      ),
    }
  }
  if (maximumBatchSize === null)
    throw new Error(`Set-like ESI operation ${operation} is missing a generated batch limit`)
  return { ...identity, maximumItems: maximumBatchSize }
}

function resolveAuthorization(operation: string, scopes: readonly string[]) {
  if (scopes.length === 0) return { kind: 'public' } as const
  if (scopes.length !== 1)
    throw new Error(`ESI operation ${operation} does not declare exactly one authorization scope`)
  return { kind: 'character', scope: scopes[0]! } as const
}
