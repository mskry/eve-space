export const platformEsiRequestSubjects = ['character_id', 'corporation_id'] as const
export type PlatformEsiRequestSubject = (typeof platformEsiRequestSubjects)[number]

export const platformEsiRolePredicates = [
  'director',
  'accountant',
  'factory-manager',
  'station-manager',
  'project-manager',
] as const
export type PlatformEsiRolePredicate = (typeof platformEsiRolePredicates)[number]

const reviewedOperationRoles = new Map<string, PlatformEsiRolePredicate>([
  ['Accountant', 'accountant'],
  ['Director', 'director'],
  ['Factory_Manager', 'factory-manager'],
  ['Project_Manager', 'project-manager'],
  ['Station_Manager', 'station-manager'],
])

export const resolveOperationRolePredicate = (
  requiredRoles: readonly string[],
): PlatformEsiRolePredicate | null => {
  if (requiredRoles.length === 0) return null
  if (new Set(requiredRoles).size !== requiredRoles.length) {
    throw new Error('Duplicate generated operation role inventory')
  }
  const key = [...requiredRoles].toSorted((a, b) => a.localeCompare(b)).join(',')
  const predicate = reviewedOperationRoles.get(key)
  if (!predicate) throw new Error(`Unsupported generated operation role inventory: ${key}`)
  return predicate
}

export type PlatformEsiAuthorizationContract =
  | {
      readonly kind: 'public'
      readonly subjectBindings: readonly PlatformEsiRequestSubject[]
      readonly requiredRolePredicate: null
    }
  | {
      readonly kind: 'oauth'
      readonly scope: string
      readonly subjectBindings: readonly PlatformEsiRequestSubject[]
      readonly requiredRolePredicate: PlatformEsiRolePredicate | null
    }

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
  version: 1,
} as const

export type PlatformCoreEsiOperationId =
  (typeof platformCoreEsiOperationCatalog.operationIds)[number]

export const platformCoreEsiOperationSdkIdentities = {
  'alliance-corporations': 'GetAlliancesAllianceIdCorporations',
  'character-asset-names': 'PostCharactersCharacterIdAssetsNames',
  'character-assets-page': 'GetCharactersCharacterIdAssets',
  'corporation-members': 'GetCorporationsCorporationIdMembers',
  'mail-headers': 'GetCharactersCharacterIdMail',
  'mail-lists': 'GetCharactersCharacterIdMailLists',
  'mail-message': 'GetCharactersCharacterIdMailMailId',
  'skill-queue': 'GetCharactersCharacterIdSkillqueue',
  skills: 'GetCharactersCharacterIdSkills',
  'universe-resolve-names': 'PostUniverseNames',
  'wallet-balance': 'GetCharactersCharacterIdWallet',
  'wallet-journal': 'GetCharactersCharacterIdWalletJournal',
  'wallet-transactions': 'GetCharactersCharacterIdWalletTransactions',
} as const satisfies Readonly<Record<PlatformCoreEsiOperationId, string>>
