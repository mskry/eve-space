export const platformModuleIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const platformModuleIdMaxLength = 44
export const platformContributionIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const platformExportNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/
export const platformMigrationFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/
export const platformReservedModuleIds = ['core', 'platform'] as const

export function isReservedPlatformModuleId(moduleId: string) {
  return (platformReservedModuleIds as readonly string[]).includes(moduleId.toLowerCase())
}

export const platformAuthorizationStrategies = ['authenticated-session', 'owned-character'] as const
export type PlatformAuthorizationStrategy = (typeof platformAuthorizationStrategies)[number]

export const platformNavigationAudiences = [
  'public',
  'authenticated',
  'admin',
  'owned-character',
] as const
export type PlatformNavigationAudience = (typeof platformNavigationAudiences)[number]

export const platformNavigationPlacements = ['dashboard', 'character'] as const
export type PlatformNavigationPlacement = (typeof platformNavigationPlacements)[number]

export interface PlatformInstalledModuleDefinition {
  readonly moduleId: string
  readonly defaultEnabled: boolean
}

export interface PlatformNavigationDefault {
  readonly ownerId: string
  readonly navigationId: string
  readonly placement: PlatformNavigationPlacement
  readonly order: number
}

export const platformPageExtensionPoints = ['root', 'character-shell'] as const
export type PlatformPageExtensionPoint = (typeof platformPageExtensionPoints)[number]

export const platformSubjectKinds = ['deployment', 'character', 'corporation', 'alliance'] as const
export type PlatformSubjectKind = (typeof platformSubjectKinds)[number]

export const platformIconTokens = [
  'overview',
  'character',
  'wallet',
  'corporation',
  'settings',
  'location',
  'ship',
  'auth',
  'admin',
] as const
export type PlatformIconToken = (typeof platformIconTokens)[number]

export interface PlatformCoreNavigationEntry extends PlatformNavigationDefault {
  readonly label: string
  readonly description: string
  readonly path: string
  readonly icon: PlatformIconToken
  readonly audience: PlatformNavigationAudience
}

export const platformCoreNavigation = [
  {
    ownerId: 'core',
    navigationId: 'core-overview',
    placement: 'dashboard',
    order: 10,
    label: 'Overview',
    description: 'System and identity summary',
    path: '/',
    icon: 'overview',
    audience: 'public',
  },
  {
    ownerId: 'core',
    navigationId: 'core-characters',
    placement: 'dashboard',
    order: 20,
    label: 'Characters',
    description: 'Authorized capsuleer record',
    path: '/characters',
    icon: 'character',
    audience: 'authenticated',
  },
  {
    ownerId: 'core',
    navigationId: 'core-settings',
    placement: 'dashboard',
    order: 30,
    label: 'Settings',
    description: 'Dashboard configuration',
    path: '/settings/integrations',
    icon: 'settings',
    audience: 'public',
  },
  {
    ownerId: 'core',
    navigationId: 'core-admin',
    placement: 'dashboard',
    order: 40,
    label: 'Admin',
    description: 'Deployment ownership and access',
    path: '/admin',
    icon: 'admin',
    audience: 'admin',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-overview',
    placement: 'character',
    order: 10,
    label: 'Overview',
    description: 'Character summary',
    path: '/characters/:characterId',
    icon: 'character',
    audience: 'owned-character',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-skills',
    placement: 'character',
    order: 20,
    label: 'Skills',
    description: 'Character skills',
    path: '/characters/:characterId/skills',
    icon: 'character',
    audience: 'owned-character',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-wallet',
    placement: 'character',
    order: 30,
    label: 'Wallet',
    description: 'Character wallet',
    path: '/characters/:characterId/wallet',
    icon: 'wallet',
    audience: 'owned-character',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-history',
    placement: 'character',
    order: 40,
    label: 'History',
    description: 'Character employment history',
    path: '/characters/:characterId/history',
    icon: 'corporation',
    audience: 'owned-character',
  },
] as const satisfies readonly PlatformCoreNavigationEntry[]

export const platformModuleRouteMount = '/api/modules'

export function resolvePlatformModuleRoutePath(namespace: string) {
  return `${platformModuleRouteMount}${namespace}`
}

export interface PlatformRouteContribution {
  id: string
  namespace: string
  exportName: string
  authorization: PlatformAuthorizationStrategy
}

export interface PlatformMigrationContribution {
  name: string
}

export interface PlatformInstalledModuleMigrationDescriptor {
  readonly moduleId: string
  readonly name: string
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

export interface PublishedSdeTypeGroup {
  readonly typeId: number
  readonly typeName: string
  readonly groupId: number
  readonly groupName: string
}

export interface SdeCoreReads {
  loadPublishedTypeGroups(typeIds: readonly number[]): Promise<readonly PublishedSdeTypeGroup[]>
}

export interface PlatformModulePersistence<Transaction> {
  transaction<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T>
}

export interface PlatformModuleRouteCapabilities<Transaction> {
  readonly persistence: PlatformModulePersistence<Transaction>
  readonly sde: SdeCoreReads
}

export interface PlatformModuleResourceTransaction {
  query<Row extends object = Readonly<Record<string, unknown>>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<readonly Row[]>
}

export interface PlatformModuleResourceCapabilities {
  readonly persistence: PlatformModulePersistence<PlatformModuleResourceTransaction>
  readonly sde: SdeCoreReads
}

export interface PlatformAuthenticatedSessionRouteContext {
  readonly authorization: {
    readonly strategy: 'authenticated-session'
    readonly userId: string
  }
}

export interface PlatformOwnedCharacterRouteContext {
  readonly authorization: {
    readonly strategy: 'owned-character'
    readonly userId: string
    readonly characterId: number
    readonly subjectLifecycleId: string
  }
  readonly coreReads: OwnedCharacterCoreReads
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

export type PlatformEsiAuthorizationContract =
  | { readonly kind: 'public' }
  | { readonly kind: 'character'; readonly scope: string }

export type PlatformEsiIdentityContract =
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

export function definePlatformEsiOperation<const Contract extends PlatformEsiOperationContract>(
  contract: Contract,
): Contract {
  return contract
}

export const platformResourceBatchModes = ['complete-observation', 'change-hint'] as const
export type PlatformResourceBatchMode = (typeof platformResourceBatchModes)[number]

export interface PlatformResourceBatchContribution {
  readonly mode: PlatformResourceBatchMode
  readonly operationId: string
}

export interface PlatformResourceContribution {
  id: string
  operationId: string
  batch?: PlatformResourceBatchContribution
  subjectKind: 'character'
  materializationIntervalSeconds: number
  eligibility: { readonly kind: 'current-owned-character' }
  exportName: string
}

export interface PlatformCharacterResourceSubject {
  readonly kind: 'character'
  readonly characterId: number
  readonly lifecycleId: string
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

export interface PlatformResourceMaterializationContext<Data> {
  readonly subject: PlatformCharacterResourceSubject
  readonly data: Data
  readonly validatedAt: string
  readonly authorizationGeneration: number | null
  readonly capabilities: PlatformModuleResourceCapabilities
}

export type PlatformCompleteObservationBatchOutcome<Data> =
  | {
      readonly subject: PlatformCharacterResourceSubject
      readonly outcome: 'complete'
      readonly data: Data
    }
  | {
      readonly subject: PlatformCharacterResourceSubject
      readonly outcome: 'unchanged'
    }

export type PlatformChangeHintBatchOutcome = {
  readonly subject: PlatformCharacterResourceSubject
  readonly outcome: 'changed' | 'unchanged'
}

interface PlatformResourceBatchOperationBase<Operation extends string> {
  readonly operation: Operation
  request(subjects: readonly PlatformCharacterResourceSubject[]): Readonly<Record<string, unknown>>
}

export type PlatformResourceBatchOperationImplementation<
  Operation extends string = string,
  Data = unknown,
  BatchData = unknown,
> =
  | (PlatformResourceBatchOperationBase<Operation> & {
      readonly mode: 'complete-observation'
      classify(input: {
        readonly subjects: readonly PlatformCharacterResourceSubject[]
        readonly data: BatchData
      }): readonly PlatformCompleteObservationBatchOutcome<Data>[]
    })
  | (PlatformResourceBatchOperationBase<Operation> & {
      readonly mode: 'change-hint'
      classify(input: {
        readonly subjects: readonly PlatformCharacterResourceSubject[]
        readonly data: BatchData
      }): readonly PlatformChangeHintBatchOutcome[]
    })

export interface PlatformResourceOperationImplementation<
  Operation extends string = string,
  OperationData = unknown,
  Data = unknown,
  BatchOperation extends string = string,
  BatchData = unknown,
> {
  readonly operation: Operation
  request(subject: PlatformCharacterResourceSubject): Readonly<Record<string, unknown>>
  map(input: {
    readonly subject: PlatformCharacterResourceSubject
    readonly data: OperationData
  }): Data
  /** Repeated delivery for the same subject lifecycle identity must converge. */
  materialize(context: PlatformResourceMaterializationContext<Data>): Promise<void>
  readonly batch?: PlatformResourceBatchOperationImplementation<BatchOperation, Data, BatchData>
}

export function definePlatformResourceOperation<
  const Operation extends string,
  OperationData,
  Data,
  const BatchOperation extends string = string,
  BatchData = unknown,
>(
  implementation: PlatformResourceOperationImplementation<
    Operation,
    OperationData,
    Data,
    BatchOperation,
    BatchData
  >,
): PlatformResourceOperationImplementation<
  Operation,
  OperationData,
  Data,
  BatchOperation,
  BatchData
> {
  return implementation
}

export interface PlatformInstalledResourceDescriptor<Implementation = unknown> {
  readonly moduleId: string
  readonly resourceId: string
  readonly operationId: string
  readonly batch?: PlatformResourceBatchContribution
  readonly subjectKind: 'character'
  readonly materializationIntervalSeconds: number
  readonly eligibility: { readonly kind: 'current-owned-character' }
  readonly implementation: Implementation
}

export interface PlatformEsiOperationContribution {
  id: string
  exportName: string
}

export interface PlatformPageContribution {
  id: string
  name: string
  path: string
  file: string
  extensionPoint: PlatformPageExtensionPoint
  audience: PlatformNavigationAudience
}

export interface PlatformNavigationContribution {
  id: string
  label: string
  description: string
  to: string
  icon?: PlatformIconToken
  audience: PlatformNavigationAudience
  placement: PlatformNavigationPlacement
  order: number
  pageName: string
}

export interface PlatformNuxtContributionDescriptor {
  readonly moduleId: string
  readonly defaultIcon: PlatformIconToken
  readonly pages: readonly PlatformPageContribution[]
  readonly navigation: readonly PlatformNavigationContribution[]
  readonly exposed?: PlatformNuxtExposedContributions
}

export interface PlatformInstalledNavigation extends Omit<PlatformNavigationContribution, 'icon'> {
  readonly moduleId: string
  readonly icon: PlatformIconToken
}

export interface PlatformNuxtExposedContributions {
  components?: readonly string[]
  composables?: readonly string[]
  hooks?: readonly string[]
  configurationKeys?: readonly string[]
  virtualFiles?: readonly string[]
}

export interface PlatformModuleManifest {
  id: string
  icon: PlatformIconToken
  defaultEnabled: boolean
  server: {
    package: string
    routes: readonly PlatformRouteContribution[]
    migrations: readonly PlatformMigrationContribution[]
    resources: readonly PlatformResourceContribution[]
    esiOperations: readonly PlatformEsiOperationContribution[]
  }
  nuxt: {
    package: string
    pages: readonly PlatformPageContribution[]
    navigation: readonly PlatformNavigationContribution[]
    exposed?: PlatformNuxtExposedContributions
  }
}
