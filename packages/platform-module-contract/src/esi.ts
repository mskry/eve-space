export type PlatformEsiAuthorizationContract =
  | { readonly kind: 'public' }
  | { readonly kind: 'character'; readonly scope: string }

export type PlatformEsiIdentityContract =
  | {
      readonly kind: 'mixed'
      readonly fields: readonly (
        | { readonly kind: 'scalar'; readonly field: string; readonly nullable?: boolean }
        | {
            readonly kind: 'set'
            readonly field: string
            readonly maximumItems: number
            readonly nullable?: boolean
          }
      )[]
    }
  | { readonly kind: 'ordered'; readonly fields: readonly string[] }
  | { readonly kind: 'set'; readonly field: string; readonly maximumItems: number }

export type PlatformEsiFreshnessContract =
  | { readonly kind: 'relative'; readonly seconds: number }
  | { readonly kind: 'daily-utc'; readonly hour: number; readonly minute: number }
  | { readonly kind: 'runtime-only' }
  | { readonly kind: 'none' }

export type PlatformEsiCacheContract =
  | {
      readonly kind: 'shared'
      readonly collapse: boolean
      readonly revalidate: boolean
      readonly stale:
        | { readonly kind: 'bounded'; readonly milliseconds: number }
        | { readonly kind: 'outage'; readonly milliseconds: number }
        | { readonly kind: 'none' }
      readonly retentionMilliseconds: number
    }
  | { readonly kind: 'none' }

export type PlatformEsiRateGroupContract =
  | { readonly kind: 'legacy-only' }
  | {
      readonly kind: 'declared'
      readonly group: string
      readonly maximumTokens: number
      readonly window: string
    }

export type PlatformEsiRetryContract =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'idempotent'
      readonly attempts: number
      readonly initialDelayMilliseconds: number
      readonly maximumDelayMilliseconds: number
    }

export type PlatformEsiResponseValidationContract =
  | { readonly kind: 'enabled' }
  | { readonly kind: 'disabled'; readonly reason: string }

export interface PlatformEsiOperationContract {
  readonly audit: {
    readonly esiOperationId: string
    readonly reviewedDate: string
  }
  readonly representationVersion: string
  readonly authorization: PlatformEsiAuthorizationContract
  readonly identity: PlatformEsiIdentityContract
  readonly freshness: PlatformEsiFreshnessContract
  readonly cache: PlatformEsiCacheContract
  readonly rateGroup: PlatformEsiRateGroupContract
  readonly retry: PlatformEsiRetryContract
  readonly compatibility: {
    readonly minimumDate: string
  }
  readonly responseValidation: PlatformEsiResponseValidationContract
}

export interface PlatformEsiRevalidation {
  readonly ifNoneMatch?: string
  readonly ifModifiedSince?: string
}

export interface PlatformEsiResponseMetadata {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly requestId?: string
  readonly pagination?: {
    readonly pages?: number
    readonly cursor?: string
    readonly nextCursor?: string
    readonly previousCursor?: string
  }
  readonly cache?: {
    readonly etag?: string
    readonly expires?: string
    readonly lastModified?: string
    readonly cacheControl?: string
  }
  readonly errorLimit?: {
    readonly remaining?: number
    readonly reset?: number
  }
}

export interface PlatformEsiLoadResult<Data> {
  readonly data: Data
  readonly meta: PlatformEsiResponseMetadata
}

export const platformCoreEsiOperationCatalog = {
  version: 1,
  operationIds: [
    'alliance-corporations',
    'character-asset-names',
    'character-assets-page',
    'corporation-members',
    'mail-headers',
    'mail-lists',
    'mail-message',
    'skill-queue',
    'skills',
    'universe-resolve-names',
    'wallet-balance',
    'wallet-journal',
    'wallet-transactions',
  ],
} as const

export type PlatformCoreEsiOperationId =
  (typeof platformCoreEsiOperationCatalog.operationIds)[number]
