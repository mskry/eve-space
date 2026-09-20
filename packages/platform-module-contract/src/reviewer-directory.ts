import type {
  PlatformReviewerAccountIdentity,
  PlatformReviewerCharacterIdentity,
  PlatformReviewerGroupIdentity,
  PlatformReviewerManagedAffiliation,
  PlatformReviewerMemberBlock,
  PlatformReviewerTargetCompliance,
} from './server.js'

export const platformReviewerDirectoryAuditStates = [
  'not-enabled',
  'authorization-required',
  'unavailable',
  'never-collected',
  'stale',
  'current',
] as const

export type PlatformReviewerDirectoryAuditState =
  (typeof platformReviewerDirectoryAuditStates)[number]

export const platformReviewerDirectoryComplianceStates = [
  'pending',
  'compliant',
  'review_required',
  'suspended',
] as const

export type PlatformReviewerDirectoryComplianceState = PlatformReviewerTargetCompliance['state']

export const platformReviewerDirectorySortDirections = ['asc', 'desc'] as const

export type PlatformReviewerDirectorySortDirection =
  (typeof platformReviewerDirectorySortDirections)[number]

export const platformReviewerDirectorySortFields = [
  'member',
  'corporation',
  'managed_since',
  'audit_data',
  'access_status',
  'disclosed_characters',
  'affiliation_checked_at',
  'site_registered_at',
  'review_deadline',
  'access_valid_until',
  'blocked_since',
] as const

export type PlatformReviewerDirectorySortField =
  (typeof platformReviewerDirectorySortFields)[number]

export const platformReviewerDirectoryDefaultSortField: PlatformReviewerDirectorySortField =
  'member'
export const platformReviewerDirectoryDefaultSortDirection: PlatformReviewerDirectorySortDirection =
  'asc'

export interface PlatformReviewerDirectoryInput {
  readonly query?: string
  readonly corporationId?: number
  readonly groupId?: string
  readonly complianceState?: PlatformReviewerDirectoryComplianceState
  readonly blocked?: boolean
  readonly auditState?: PlatformReviewerDirectoryAuditState
  readonly sort?: PlatformReviewerDirectorySortField
  readonly direction?: PlatformReviewerDirectorySortDirection
  readonly cursor?: string
  readonly limit?: number
}

export interface PlatformReviewerDirectoryRow {
  readonly managedMemberLifecycleId: string
  readonly managedSince: string
  readonly siteRegisteredAt: string
  readonly account: PlatformReviewerAccountIdentity
  readonly portraitCharacter: PlatformReviewerCharacterIdentity & {
    readonly source: 'main-character' | 'managed-affiliation'
  }
  readonly managedAffiliation: PlatformReviewerManagedAffiliation
  readonly disclosedCharacterCount: number
  readonly groups: readonly PlatformReviewerGroupIdentity[]
  readonly compliance: PlatformReviewerTargetCompliance
  readonly block: PlatformReviewerMemberBlock
  readonly auditData: {
    readonly state: PlatformReviewerDirectoryAuditState
    readonly expected: number
    readonly covered: number
    readonly asOf: string | null
  }
}

export interface PlatformReviewerDirectoryPage {
  readonly organizationVersion: number
  readonly status: 'available' | 'unavailable'
  readonly items: readonly PlatformReviewerDirectoryRow[]
  readonly groupFacets: readonly PlatformReviewerGroupIdentity[]
  readonly nextCursor: string | null
}
