import type { CoreDataProductId } from '@eve-space/core-data-contract'
import type {
  PlatformPersistenceContributionReferences,
  PlatformPersistenceOperationReference,
} from './persistence.js'
import type { PlatformInstalledOrganizationContributionAuthorization } from './installed.js'
import type {
  PlatformModuleCollectionStatusReads,
  PlatformModuleContributionCapabilities,
  PlatformOrganizationContributionAuthorization,
  PlatformSectionBoundContribution,
} from './server.js'

export const platformActivityFreshnessStates = [
  'current',
  'stale',
  'unavailable',
  'authorization-required',
] as const
export type PlatformActivityFreshnessState = (typeof platformActivityFreshnessStates)[number]

export const platformActivityRequiredActionKinds = [
  'authorization',
  'acceptance',
  'delivery',
  'participation',
  'other',
] as const
export type PlatformActivityRequiredActionKind =
  (typeof platformActivityRequiredActionKinds)[number]

export const platformActivityParticipationStates = [
  'eligible',
  'not-participating',
  'participating',
  'completed',
  'authorization-required',
  'unavailable',
] as const
export type PlatformActivityParticipationState =
  (typeof platformActivityParticipationStates)[number]

export const platformActivityProviderMaximumActivities = 100
export const platformActivityProviderTimeoutMilliseconds = 2_000

export interface PlatformActivityFreshness {
  readonly state: PlatformActivityFreshnessState
  readonly collectedAt: string | null
}

export interface PlatformActivityRequiredAction {
  readonly kind: PlatformActivityRequiredActionKind
  readonly label: string
  readonly characterId: number | null
}

export interface PlatformActivityParticipation {
  readonly characterId: number
  readonly state: PlatformActivityParticipationState
  readonly contribution: number | null
}

export interface PlatformActivityLinkTarget {
  readonly activityId?: string
  readonly corporationId?: number | null
  readonly pageId: string
  readonly characterId: number | null
}

export interface PlatformActivity {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly summary: string | null
  readonly objective: string | null
  readonly state: string
  readonly progress: { readonly current: number; readonly desired: number } | null
  readonly reward: { readonly initial: number; readonly remaining: number } | null
  readonly requiredAction: PlatformActivityRequiredAction | null
  readonly organizationPriority: number
  readonly deadline: string | null
  readonly eligibleCharacterIds: readonly number[]
  readonly participation: readonly PlatformActivityParticipation[]
  readonly linkTarget: PlatformActivityLinkTarget | null
  readonly freshness: PlatformActivityFreshness
}

export interface PlatformActivityProviderResult {
  readonly activities: readonly PlatformActivity[]
  readonly freshness: PlatformActivityFreshness
}

export interface PlatformActivityProviderCharacter {
  readonly characterId: number
  readonly subjectLifecycleId: string
  readonly name: string
  readonly corporationId: number
  readonly allianceId: number | null
  readonly isMain: boolean
  readonly membership: 'managed' | 'approved-external'
  readonly affiliationFreshness: 'fresh' | 'stale' | 'unavailable'
  readonly affiliationCheckedAt: string | null
}

export interface PlatformActivityProviderContext {
  readonly userId: string
  readonly organizationVersion: number
  readonly requestedAt: string
  readonly signal: AbortSignal
  readonly characters: readonly PlatformActivityProviderCharacter[]
}

export type PlatformActivityProviderCapabilities<
  Persistence extends object = object,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
> = PlatformModuleContributionCapabilities<Persistence, ProductIds> & {
  readonly collectionStatus: PlatformModuleCollectionStatusReads
}

export type PlatformActivityProvider = (
  context: PlatformActivityProviderContext,
) => Promise<PlatformActivityProviderResult>

export type PlatformActivityProviderFactory<
  Persistence extends object = object,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
> = (
  capabilities: PlatformActivityProviderCapabilities<Persistence, ProductIds>,
) => PlatformActivityProvider

export interface PlatformActivityProviderContribution
  extends
    PlatformOrganizationContributionAuthorization,
    PlatformPersistenceContributionReferences,
    PlatformSectionBoundContribution {
  readonly coreDataProducts?: readonly CoreDataProductId[]
  readonly id: string
  readonly exportName: string
  readonly freshness: {
    readonly staleAfterSeconds: number
  }
}

export interface PlatformInstalledActivityProviderDescriptor extends PlatformInstalledOrganizationContributionAuthorization {
  readonly coreDataProducts: readonly CoreDataProductId[]
  readonly moduleId: string
  readonly providerId: string
  readonly freshness: {
    readonly staleAfterSeconds: number
  }
  readonly pageIds: readonly string[]
  readonly persistenceOperations?: readonly PlatformPersistenceOperationReference[]
  readonly invoke: PlatformActivityProvider
  readonly sectionId?: string
}
