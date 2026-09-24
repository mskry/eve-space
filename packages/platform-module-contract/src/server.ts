import type { CoreDataMethodsFor, CoreDataProductId } from '@eve-space/core-data-contract'

const reviewerAccountSearchMaximumQueryLength = 80
const reviewerAccountSearchMaximumCursorLength = 512

export function isPlatformReviewerAccountSearchQuery(value: string) {
  if (value.length === 0 || value.length > reviewerAccountSearchMaximumQueryLength) {
    return false
  }
  for (const character of value) {
    if (character.codePointAt(0)! < 32) return false
  }
  return true
}

export function isPlatformReviewerAccountSearchCursor(value: string) {
  if (value.length === 0 || value.length > reviewerAccountSearchMaximumCursorLength) {
    return false
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    const alphanumeric =
      (codePoint >= 48 && codePoint <= 57) ||
      (codePoint >= 65 && codePoint <= 90) ||
      (codePoint >= 97 && codePoint <= 122)
    if (!alphanumeric && character !== '_' && character !== '-') {
      return false
    }
  }
  return true
}

export const platformAuthorizationStrategies = ['authenticated-session', 'owned-character'] as const
export type PlatformAuthorizationStrategy = (typeof platformAuthorizationStrategies)[number]

export const platformOrganizationAudiences = ['member', 'hr', 'director'] as const
export type PlatformOrganizationAudience = (typeof platformOrganizationAudiences)[number]

export const platformModuleSectionKinds = [
  'workspace',
  'sensitive-evidence',
  'access-management',
] as const
export type PlatformModuleSectionKind = (typeof platformModuleSectionKinds)[number]

export type PlatformModuleSectionContribution =
  | {
      readonly id: string
      readonly kind: 'workspace' | 'access-management'
      readonly defaultEnabled: false
      readonly disclosureRevision?: never
    }
  | {
      readonly id: string
      readonly kind: 'sensitive-evidence'
      readonly defaultEnabled: false
      readonly disclosureRevision: number
    }

export const platformRouteTargets = [
  'caller',
  'managed-organization-account-search',
  'managed-organization-account',
  'managed-organization-character',
] as const
export type PlatformRouteTarget = (typeof platformRouteTargets)[number]

export const platformReviewerTargetKinds = [
  'managed-organization-account',
  'managed-organization-character',
] as const
export type PlatformReviewerTargetKind = (typeof platformReviewerTargetKinds)[number]

export interface PlatformReviewerRouteLink extends PlatformOrganizationContributionAuthorization {
  readonly routeId: string
  readonly target: PlatformReviewerTargetKind
}

export interface PlatformReviewerServerContribution extends PlatformReviewerRouteLink {
  readonly contributionId: string
}

export const platformRouteExposures = ['standard', 'sensitive-evidence'] as const
export type PlatformRouteExposure = (typeof platformRouteExposures)[number]

export interface PlatformSectionBoundContribution {
  readonly sectionId?: string
}

export interface PlatformRouteSecurityClassification
  extends PlatformSectionBoundContribution, PlatformOrganizationCommandContribution {
  readonly target?: PlatformRouteTarget
  readonly exposure?: PlatformRouteExposure
  readonly reviewerEvidenceResourceId?: string
}

export const platformOrganizationCommandIds = [
  'assign-ordinary-group',
  'revoke-ordinary-group',
  'block-member',
  'unblock-member',
] as const
export type PlatformOrganizationCommandId = (typeof platformOrganizationCommandIds)[number]

export interface PlatformOrganizationCommandContribution {
  readonly organizationCommands?: readonly PlatformOrganizationCommandId[]
}

export interface PlatformOrganizationContributionAuthorization {
  readonly audience: PlatformOrganizationAudience
  readonly requiredPermission: string
  readonly additionalRequiredPermissions?: readonly string[]
}

export function platformOrganizationAdmissionScope(
  ownerId: string,
  authorization: PlatformOrganizationContributionAuthorization,
) {
  const permissions = [
    authorization.requiredPermission,
    ...(authorization.additionalRequiredPermissions ?? []),
  ].toSorted((left, right) => left.localeCompare(right))
  return `organization:v1:${ownerId}:${authorization.audience}:${permissions.join(',')}`
}

export const coreOrganizationAdmissionScopes = {
  activities: platformOrganizationAdmissionScope('core', {
    audience: 'member',
    requiredPermission: 'organization.activities',
  }),
  rosterCoverage: platformOrganizationAdmissionScope('core', {
    audience: 'hr',
    requiredPermission: 'organization.roster-coverage',
  }),
} as const

export const platformModuleRouteMount = '/api/modules'

export function resolvePlatformModuleRoutePath(namespace: string) {
  return `${platformModuleRouteMount}${namespace}`
}

export type CharacterAffiliationResolutionState = 'pending' | 'resolved' | 'unresolvable'

export interface OwnedCharacterAffiliation {
  readonly characterId: number
  readonly corporationId: number
  readonly allianceId: number | null
  readonly checkedAt: string | null
  readonly resolutionState: CharacterAffiliationResolutionState
}

export interface OwnedCharacterCoreReads {
  loadAffiliation(): Promise<OwnedCharacterAffiliation | null>
}

export const platformModuleLogLevels = ['info', 'warn', 'error'] as const
export type PlatformModuleLogLevel = (typeof platformModuleLogLevels)[number]
export type PlatformModuleLogValue = string | number | boolean | null
export type PlatformModuleLogFields = Readonly<Record<string, PlatformModuleLogValue>>

export interface PlatformModuleLogger {
  info(event: string, fields?: PlatformModuleLogFields): void
  warn(event: string, fields?: PlatformModuleLogFields): void
  error(event: string, fields?: PlatformModuleLogFields): void
}

export const platformCollectionFailureClasses = [
  'authorization-required',
  'esi-cooldown',
  'esi-unavailable',
  'response-invalid',
  'mapping-failed',
  'persistence-failed',
  'unknown',
] as const
export type PlatformCollectionFailureClass = (typeof platformCollectionFailureClasses)[number]

interface PlatformCollectionStatusBase {
  readonly subjectLifecycleId?: string
  readonly authorizationGeneration: number | null
  readonly lastFailureClass: PlatformCollectionFailureClass | null
  readonly validatedAt: string | null
}

export type PlatformCollectionStatus =
  | (PlatformCollectionStatusBase & { readonly status: 'current' | 'stale' })
  | (PlatformCollectionStatusBase & {
      readonly status: 'never-collected' | 'never-configured' | 'unavailable'
    })
  | (PlatformCollectionStatusBase & {
      readonly status: 'authorization-required'
      readonly lastFailureClass: 'authorization-required'
      readonly requiredScope: string
      readonly reauthorizationPath: string
    })

export type PlatformCollectionStatusSubject =
  | { readonly kind: 'deployment'; readonly deploymentId: number }
  | { readonly kind: 'character'; readonly characterId: number }
  | { readonly kind: 'corporation'; readonly corporationId: number }
  | { readonly kind: 'alliance'; readonly allianceId: number }

export interface PlatformModuleCollectionStatusReads {
  read(
    resourceId: string,
    subject: PlatformCollectionStatusSubject,
  ): Promise<PlatformCollectionStatus>
}

interface PlatformReviewerCollectionStatusBase {
  readonly moduleId: string
  readonly sectionId: string
  readonly resourceId: string
  readonly organizationVersion: number
  readonly targetUserId: string
  readonly managedMemberLifecycleId: string
  readonly characterId: number
  readonly characterLifecycleId: string
  readonly authorizationGeneration: number | null
  readonly disclosureVersion: number
  readonly sectionActivationVersion: number
  readonly validatedAt: string | null
  readonly lastFailureClass: PlatformCollectionFailureClass | null
}

export type PlatformReviewerCollectionStatus =
  | (PlatformReviewerCollectionStatusBase & {
      readonly status: 'current' | 'stale' | 'never-collected' | 'unavailable'
    })
  | (PlatformReviewerCollectionStatusBase & {
      readonly status: 'authorization-required'
      readonly lastFailureClass: 'authorization-required'
      readonly requiredScope: string
    })

export interface PlatformReviewerCollectionStatusReads {
  read(resourceId: string, characterId: number): Promise<PlatformReviewerCollectionStatus>
}

export interface PlatformReviewerEvidenceResourceSummary {
  readonly resourceId: string
  readonly status: PlatformReviewerCollectionStatus['status']
  readonly validatedAt: string | null
}

export interface PlatformReviewerEvidenceSectionSummary {
  readonly sectionId: string
  readonly resources: readonly PlatformReviewerEvidenceResourceSummary[]
}

export interface PlatformReviewerCharacterEvidenceSummary {
  readonly characterId: number
  readonly sections: readonly PlatformReviewerEvidenceSectionSummary[]
}

export interface PlatformReviewerEvidenceSummaryReads {
  read(): Promise<readonly PlatformReviewerCharacterEvidenceSummary[]>
}

export interface PlatformReviewerEvidenceReads {
  read(options?: { readonly limit?: number }): Promise<unknown>
}

export interface PlatformSafeErrorBody {
  readonly message: string
  readonly code?: string
}

export interface PlatformModuleErrorBody extends PlatformSafeErrorBody {
  readonly code: string
}

export interface PlatformModuleContributionCapabilities<
  Persistence extends object = object,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
> {
  readonly coreData: CoreDataMethodsFor<ProductIds>
  readonly logger: PlatformModuleLogger
  readonly persistence: Persistence
}

export type PlatformModuleRouteCapabilities<
  Persistence extends object = object,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
> = PlatformModuleContributionCapabilities<Persistence, ProductIds>

export interface PlatformAuthorizedOrganizationContext {
  readonly organizationVersion: number
  readonly audience: PlatformOrganizationAudience
  readonly requiredPermission: string
  readonly additionalRequiredPermissions?: readonly string[]
  readonly entitlementScope: 'all' | 'review'
}

export interface PlatformReviewerCharacterIdentity {
  readonly characterId: number
  readonly name: string
}

export interface PlatformReviewerAccountIdentity {
  readonly userId: string
  readonly mainCharacter: PlatformReviewerCharacterIdentity | null
}

export interface PlatformReviewerManagedAffiliation extends PlatformReviewerCharacterIdentity {
  readonly corporationId: number
  readonly allianceId: number | null
  readonly checkedAt: string
}

export type PlatformReviewerMemberBlock =
  | { readonly blocked: false }
  | { readonly blocked: true; readonly blockedAt: string }

export interface PlatformReviewerGroupIdentity {
  readonly groupId: string
  readonly name: string
}

export interface PlatformReviewerTargetCharacter extends PlatformReviewerCharacterIdentity {
  readonly subjectLifecycleId: string
  readonly authorizationGeneration: number | null
  readonly isMain: boolean
  readonly affiliation: {
    readonly corporationId: number
    readonly allianceId: number | null
    readonly membership: 'managed' | 'approved-external'
    readonly freshness: 'fresh' | 'stale' | 'unavailable'
    readonly checkedAt: string | null
  }
}

export interface PlatformReviewerTargetCompliance {
  readonly state: 'pending' | 'compliant' | 'review_required' | 'suspended'
  readonly evidenceFreshness: 'fresh' | 'stale' | 'unavailable'
  readonly evidenceAt: string | null
  readonly reviewDeadline: string | null
  readonly accessValidUntil: string | null
  readonly evaluatedAt: string | null
}

export interface PlatformReviewerTargetGroup extends PlatformReviewerGroupIdentity {
  readonly assignmentId: string
  readonly restricted: boolean
  readonly managementMode: 'manual' | 'compliance'
  readonly readOnly: boolean
  readonly assignedAt: string
  readonly expiresAt: string | null
}

export interface PlatformReviewerTargetContext {
  readonly organizationVersion: number
  readonly managedMemberLifecycleId: string
  readonly selection:
    | { readonly kind: 'account' }
    | {
        readonly kind: 'character'
        readonly characterId: number
        readonly subjectLifecycleId: string
      }
  readonly account: PlatformReviewerAccountIdentity
  readonly characters: readonly PlatformReviewerTargetCharacter[]
  readonly compliance: PlatformReviewerTargetCompliance
  readonly groups: readonly PlatformReviewerTargetGroup[]
  readonly block: PlatformReviewerMemberBlock
}

export interface PlatformReviewerAccountSearchInput {
  readonly query?: string
  readonly corporationId?: number
  readonly complianceState?: PlatformReviewerTargetCompliance['state']
  readonly blocked?: boolean
  readonly cursor?: string
  readonly limit?: number
}

export interface PlatformReviewerAccountSearchItem {
  readonly managedMemberLifecycleId: string
  readonly account: PlatformReviewerAccountIdentity
  readonly managedAffiliation: PlatformReviewerManagedAffiliation
  readonly compliance: PlatformReviewerTargetCompliance
  readonly block: PlatformReviewerMemberBlock
  readonly evidenceSections: readonly PlatformReviewerEvidenceSectionSummary[]
}

export interface PlatformReviewerAccountSearchPage {
  readonly organizationVersion: number
  readonly status: 'available' | 'unavailable'
  readonly items: readonly PlatformReviewerAccountSearchItem[]
  readonly nextCursor: string | null
}

export interface PlatformReviewerAccountSearch {
  search(input: PlatformReviewerAccountSearchInput): Promise<PlatformReviewerAccountSearchPage>
}

export interface PlatformAssignOrdinaryGroupInput {
  readonly groupId: string
  readonly reason: string
  readonly expiresAt?: string | null
}

export interface PlatformAssignOrdinaryGroupResult {
  readonly decision: 'assigned'
  readonly groupId: string
  readonly assignmentId: string
  readonly expiresAt: string | null
}

export type PlatformAssignOrdinaryGroupMethod = (
  input: PlatformAssignOrdinaryGroupInput,
) => Promise<PlatformAssignOrdinaryGroupResult>

export interface PlatformRevokeOrdinaryGroupInput {
  readonly groupId: string
  readonly assignmentId: string
  readonly reason: string
}

export interface PlatformRevokeOrdinaryGroupResult {
  readonly decision: 'revoked'
  readonly groupId: string
  readonly assignmentId: string
  readonly revokedAt: string
}

export type PlatformRevokeOrdinaryGroupMethod = (
  input: PlatformRevokeOrdinaryGroupInput,
) => Promise<PlatformRevokeOrdinaryGroupResult>

export interface PlatformBlockMemberInput {
  readonly reason: string
}

export interface PlatformBlockMemberResult {
  readonly decision: 'blocked'
  readonly blockId: string
  readonly blockedAt: string
}

export type PlatformBlockMemberMethod = (
  input: PlatformBlockMemberInput,
) => Promise<PlatformBlockMemberResult>

export interface PlatformUnblockMemberInput {
  readonly reason: string
}

export interface PlatformUnblockMemberResult {
  readonly decision: 'unblocked'
  readonly blockId: string
  readonly unblockedAt: string
}

export type PlatformUnblockMemberMethod = (
  input: PlatformUnblockMemberInput,
) => Promise<PlatformUnblockMemberResult>

export interface PlatformAssignOrdinaryGroupCapability {
  readonly assignOrdinaryGroup: PlatformAssignOrdinaryGroupMethod
}

export interface PlatformRevokeOrdinaryGroupCapability {
  readonly revokeOrdinaryGroup: PlatformRevokeOrdinaryGroupMethod
}

export interface PlatformBlockMemberCapability {
  readonly blockMember: PlatformBlockMemberMethod
}

export interface PlatformUnblockMemberCapability {
  readonly unblockMember: PlatformUnblockMemberMethod
}

export type PlatformOrganizationCommandCapabilities<
  CommandIds extends readonly PlatformOrganizationCommandId[],
> = ('assign-ordinary-group' extends CommandIds[number]
  ? PlatformAssignOrdinaryGroupCapability
  : object) &
  ('revoke-ordinary-group' extends CommandIds[number]
    ? PlatformRevokeOrdinaryGroupCapability
    : object) &
  ('block-member' extends CommandIds[number] ? PlatformBlockMemberCapability : object) &
  ('unblock-member' extends CommandIds[number] ? PlatformUnblockMemberCapability : object)

export interface PlatformAuthenticatedSessionRouteContext {
  readonly authorization: {
    readonly strategy: 'authenticated-session'
    readonly userId: string
  }
  readonly collectionStatus: PlatformModuleCollectionStatusReads
  readonly organization: PlatformAuthorizedOrganizationContext
}

export interface PlatformOwnedCharacterRouteContext {
  readonly authorization: {
    readonly strategy: 'owned-character'
    readonly userId: string
    readonly characterId: number
    readonly subjectLifecycleId: string
  }
  readonly collectionStatus: PlatformModuleCollectionStatusReads
  readonly organization: PlatformAuthorizedOrganizationContext
  readonly coreReads: OwnedCharacterCoreReads
}

interface PlatformReviewerTargetRouteContextBase {
  readonly authorization: {
    readonly strategy: 'authenticated-session'
    readonly userId: string
  }
  readonly organization: PlatformAuthorizedOrganizationContext
  readonly collectionStatus: PlatformReviewerCollectionStatusReads
  readonly evidence?: PlatformReviewerEvidenceReads
  readonly evidenceSummary: PlatformReviewerEvidenceSummaryReads
  readonly reviewerTarget: PlatformReviewerTargetContext
}

type PlatformReviewerTargetRouteCommandContext<
  CommandIds extends readonly PlatformOrganizationCommandId[],
> = CommandIds extends readonly []
  ? object
  : {
      readonly organizationCommands: PlatformOrganizationCommandCapabilities<CommandIds>
    }

export type PlatformReviewerTargetRouteContext<
  CommandIds extends readonly PlatformOrganizationCommandId[] = readonly [],
> = PlatformReviewerTargetRouteContextBase & PlatformReviewerTargetRouteCommandContext<CommandIds>

export interface PlatformReviewerSearchRouteContext {
  readonly authorization: {
    readonly strategy: 'authenticated-session'
    readonly userId: string
  }
  readonly organization: PlatformAuthorizedOrganizationContext
  readonly reviewerSearch: PlatformReviewerAccountSearch
}

export interface PlatformAuthenticatedSessionRouteEnv {
  Variables: {
    platform: PlatformAuthenticatedSessionRouteContext
  }
}

export interface PlatformOwnedCharacterRouteEnv {
  Variables: {
    platform: PlatformOwnedCharacterRouteContext
  }
}

export interface PlatformReviewerTargetRouteEnv<
  CommandIds extends readonly PlatformOrganizationCommandId[] = readonly [],
> {
  Variables: {
    platform: PlatformReviewerTargetRouteContext<CommandIds>
  }
}

export interface PlatformReviewerSearchRouteEnv {
  Variables: {
    platform: PlatformReviewerSearchRouteContext
  }
}
