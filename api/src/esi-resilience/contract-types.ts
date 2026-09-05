import type {
  PlatformEsiFreshnessContract,
  PlatformEsiOperationContract,
  PlatformEsiResponseValidationContract,
  PlatformEsiRetryContract,
} from '@eve-space/platform-module-contract'
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
  readonly mutation?: EsiMutationContract
}

/**
 * The catalog's derived operation unions read `cache` and `mutation` off each entry, so those
 * discriminants must survive `defineContract` as literals rather than collapsing to their unions.
 */
export type ResolvedCoreEsiOperationContract<
  Operation extends keyof typeof esiOperationMetadata,
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

export type ResolvedIdentity<Identity extends EsiIdentityConfiguration> = Identity extends {
  kind: 'set'
  field: infer Field extends string
}
  ? { kind: 'set'; field: Field; maximumItems: number }
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
  Operation,
  ResolvedIdentity<Options['identity']>,
  ResolvedCache<Options['cache']>,
  ResolvedMutation<Options>
> {
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
    mutation: options.mutation,
  }
  return contract as ResolvedCoreEsiOperationContract<
    Operation,
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

export function sharedPrivateCache(retentionMilliseconds = hour): EsiCacheConfiguration {
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
