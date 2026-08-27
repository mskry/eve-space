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

export interface PlatformModuleValidationAuthorities {
  reservedModuleIds: readonly string[]
  navigationIds: readonly string[]
  esiOperationIds: readonly string[]
}

export class PlatformModuleValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    const sortedIssues = issues.toSorted(compareStable)
    super(
      `Invalid platform module declarations:\n${sortedIssues.map((issue) => `- ${issue}`).join('\n')}`,
    )
    this.name = 'PlatformModuleValidationError'
    this.issues = sortedIssues
  }
}

export function validatePlatformModuleManifests(
  manifests: readonly PlatformModuleManifest[],
  authorities: PlatformModuleValidationAuthorities,
): readonly PlatformModuleManifest[] {
  const issues: string[] = []
  const sorted = [...manifests].toSorted((left, right) => compareStable(left.id, right.id))

  validateUniqueValues(
    sorted.map((manifest) => ({ value: manifest.id, owner: manifest.id })),
    'module ID',
    issues,
  )

  const reservedModuleIds = new Set(authorities.reservedModuleIds.map((id) => id.toLowerCase()))
  const routeCoordinates = new Map<string, string>()
  const navigationIds = createOwnedValues(authorities.navigationIds, 'core')
  const esiOperationIds = createOwnedValues(authorities.esiOperationIds, 'core')
  const migrationIds = new Map<string, string>()
  const resourceIds = new Map<string, string>()

  claimEsiOperationIds(sorted, esiOperationIds, issues)

  const context: PlatformManifestValidationContext = {
    issues,
    reservedModuleIds,
    routeCoordinates,
    navigationIds,
    esiOperationIds,
    migrationIds,
    resourceIds,
  }
  for (const manifest of sorted) validatePlatformModuleManifest(manifest, context)

  if (issues.length > 0) throw new PlatformModuleValidationError(issues)
  return sorted
}

interface PlatformManifestValidationContext {
  issues: string[]
  reservedModuleIds: ReadonlySet<string>
  routeCoordinates: Map<string, string>
  navigationIds: Map<string, string>
  esiOperationIds: Map<string, string>
  migrationIds: Map<string, string>
  resourceIds: Map<string, string>
}

function claimEsiOperationIds(
  manifests: readonly PlatformModuleManifest[],
  esiOperationIds: Map<string, string>,
  issues: string[],
) {
  for (const manifest of manifests) {
    for (const operation of manifest.server.esiOperations)
      claimValue(esiOperationIds, operation.id, manifest.id, 'ESI operation ID', issues)
  }
}

function validatePlatformModuleManifest(
  manifest: PlatformModuleManifest,
  context: PlatformManifestValidationContext,
) {
  validateManifestIdentity(manifest, context.reservedModuleIds, context.issues)
  validatePackageNames(manifest, context.issues)
  validateManifestIcon(manifest, context.issues)
  validateRouteNamespaceIntersections(manifest, context.issues)
  validateRoutes(manifest, context.routeCoordinates, context.issues)
  validateMigrations(manifest, context.migrationIds, context.issues)
  validateEsiOperationContributions(manifest, context.issues)
  validateResources(manifest, context.resourceIds, context.esiOperationIds, context.issues)
  validatePages(manifest, context.issues)
  validateNavigation(manifest, context.navigationIds, context.issues)
  validateExposedContributions(manifest, context.issues)
}

function validateManifestIcon(manifest: PlatformModuleManifest, issues: string[]) {
  if (!platformIconTokens.includes(manifest.icon))
    issues.push(`module ${manifest.id} uses invalid default icon ${String(manifest.icon)}`)
}

function validateRoutes(
  manifest: PlatformModuleManifest,
  routeCoordinates: Map<string, string>,
  issues: string[],
) {
  for (const route of manifest.server.routes)
    validateRoute(manifest.id, route, routeCoordinates, issues)
}

function validateRoute(
  moduleId: string,
  route: PlatformRouteContribution,
  routeCoordinates: Map<string, string>,
  issues: string[],
) {
  validateContributionId(route.id, moduleId, 'route', issues)
  validateExportName(route.exportName, moduleId, 'route', issues)
  const moduleNamespace = `/${moduleId}`
  if (route.namespace !== moduleNamespace && !route.namespace.startsWith(`${moduleNamespace}/`))
    issues.push(
      `route ${moduleId}/${route.id} namespace must be ${moduleNamespace} or begin with ${moduleNamespace}/`,
    )
  if (!isNormalizedPath(route.namespace))
    issues.push(`route ${moduleId}/${route.id} has invalid namespace ${route.namespace}`)
  claimValue(
    routeCoordinates,
    canonicalizePath(resolvePlatformModuleRoutePath(route.namespace)),
    moduleId,
    'module route coordinate',
    issues,
  )
  if (!platformAuthorizationStrategies.includes(route.authorization))
    issues.push(
      `route ${moduleId}/${route.id} uses unsupported authorization ${String(route.authorization)}`,
    )
  if (
    route.authorization === 'owned-character' &&
    !route.namespace.split('/').includes(':characterId')
  )
    issues.push(
      `owned-character route ${moduleId}/${route.id} must include :characterId in its namespace`,
    )
}

function validateMigrations(
  manifest: PlatformModuleManifest,
  migrationIds: Map<string, string>,
  issues: string[],
) {
  for (const migration of manifest.server.migrations)
    validateMigration(manifest.id, migration, migrationIds, issues)
}

function validateMigration(
  moduleId: string,
  migration: PlatformMigrationContribution,
  migrationIds: Map<string, string>,
  issues: string[],
) {
  const identity = `${moduleId}/${migration.name}`
  if (!migration.name.startsWith(`${moduleId}-`) || !migration.name.endsWith('.sql'))
    issues.push(`migration ${identity} must use ${moduleId}-*.sql`)
  if (!platformMigrationFilenamePattern.test(migration.name))
    issues.push(`migration ${identity} must be a package-local filename`)
  claimValue(migrationIds, identity, moduleId, 'migration identity', issues)
}

function validateEsiOperationContributions(manifest: PlatformModuleManifest, issues: string[]) {
  for (const operation of manifest.server.esiOperations) {
    validateContributionId(operation.id, manifest.id, 'ESI operation', issues)
    validateExportName(operation.exportName, manifest.id, 'ESI operation', issues)
  }
}

function validateResources(
  manifest: PlatformModuleManifest,
  resourceIds: Map<string, string>,
  esiOperationIds: ReadonlyMap<string, string>,
  issues: string[],
) {
  for (const resource of manifest.server.resources)
    validateResource(manifest.id, resource, resourceIds, esiOperationIds, issues)
}

function validateResource(
  moduleId: string,
  resource: PlatformResourceContribution,
  resourceIds: Map<string, string>,
  esiOperationIds: ReadonlyMap<string, string>,
  issues: string[],
) {
  validateContributionId(resource.id, moduleId, 'resource', issues)
  validateExportName(resource.exportName, moduleId, 'resource', issues)
  claimValue(resourceIds, resource.id, moduleId, 'resource ID', issues)
  if (resource.subjectKind !== 'character')
    issues.push(
      `resource ${moduleId}/${resource.id} uses unsupported initial subject kind ${String(resource.subjectKind)}`,
    )
  if (
    !Number.isSafeInteger(resource.materializationIntervalSeconds) ||
    resource.materializationIntervalSeconds <= 0
  )
    issues.push(`resource ${moduleId}/${resource.id} must use a positive whole interval`)
  if (resource.eligibility?.kind !== 'current-owned-character')
    issues.push(
      `resource ${moduleId}/${resource.id} uses unsupported eligibility ${String(resource.eligibility?.kind)}`,
    )
  if (!esiOperationIds.has(normalizeIdentity(resource.operationId)))
    issues.push(
      `resource ${moduleId}/${resource.id} references unknown ESI operation ${resource.operationId}`,
    )
  validateResourceBatch(moduleId, resource, esiOperationIds, issues)
}

function validateResourceBatch(
  moduleId: string,
  resource: PlatformResourceContribution,
  esiOperationIds: ReadonlyMap<string, string>,
  issues: string[],
) {
  const batch = resource.batch
  if (batch === undefined) return
  if (!platformResourceBatchModes.includes(batch.mode))
    issues.push(
      `resource ${moduleId}/${resource.id} uses unsupported batch mode ${String(batch.mode)}`,
    )
  if (!esiOperationIds.has(normalizeIdentity(batch.operationId)))
    issues.push(
      `resource ${moduleId}/${resource.id} references unknown batch ESI operation ${batch.operationId}`,
    )
}

function validatePages(manifest: PlatformModuleManifest, issues: string[]) {
  for (const page of manifest.nuxt.pages) validatePage(manifest.id, page, issues)
}

function validatePage(moduleId: string, page: PlatformPageContribution, issues: string[]) {
  validateContributionId(page.id, moduleId, 'page', issues)
  if (!page.name.startsWith(`eve-${moduleId}-`))
    issues.push(`page ${moduleId}/${page.id} name must begin with eve-${moduleId}-`)
  if (!isNormalizedPath(page.path))
    issues.push(`page ${moduleId}/${page.id} has invalid path ${page.path}`)
  if (
    !page.file.startsWith('src/runtime/app/pages/') ||
    !page.file.endsWith('.vue') ||
    page.file.split('/').some((segment) => segment === '.' || segment === '..')
  )
    issues.push(`page ${moduleId}/${page.id} file must be a Vue file under src/runtime/app/pages`)
  if (!platformPageExtensionPoints.includes(page.extensionPoint))
    issues.push(
      `page ${moduleId}/${page.id} uses unsupported extension point ${String(page.extensionPoint)}`,
    )
  if (!platformNavigationAudiences.includes(page.audience))
    issues.push(`page ${moduleId}/${page.id} uses unsupported audience ${String(page.audience)}`)
}

function validateNavigation(
  manifest: PlatformModuleManifest,
  navigationIds: Map<string, string>,
  issues: string[],
) {
  for (const navigation of manifest.nuxt.navigation)
    validateNavigationEntry(manifest, navigation, navigationIds, issues)
}

function validateNavigationEntry(
  manifest: PlatformModuleManifest,
  navigation: PlatformNavigationContribution,
  navigationIds: Map<string, string>,
  issues: string[],
) {
  validateContributionId(navigation.id, manifest.id, 'navigation', issues)
  if (navigation.icon !== undefined && !platformIconTokens.includes(navigation.icon))
    issues.push(
      `navigation ${manifest.id}/${navigation.id} uses invalid icon ${String(navigation.icon)}`,
    )
  if (!platformNavigationAudiences.includes(navigation.audience))
    issues.push(
      `navigation ${manifest.id}/${navigation.id} uses unsupported audience ${String(navigation.audience)}`,
    )
  if (!platformNavigationPlacements.includes(navigation.placement))
    issues.push(
      `navigation ${manifest.id}/${navigation.id} uses unsupported placement ${String(navigation.placement)}`,
    )
  if (!Number.isSafeInteger(navigation.order))
    issues.push(`navigation ${manifest.id}/${navigation.id} order must be a safe integer`)
  if (!manifest.nuxt.pages.some((page) => page.name === navigation.pageName))
    issues.push(
      `navigation ${manifest.id}/${navigation.id} references undeclared page ${navigation.pageName}`,
    )
  claimValue(navigationIds, navigation.id, manifest.id, 'navigation ID', issues)
}

function validateRouteNamespaceIntersections(manifest: PlatformModuleManifest, issues: string[]) {
  for (const [index, route] of manifest.server.routes.entries()) {
    for (const candidate of manifest.server.routes.slice(index + 1)) {
      if (canonicalizePath(route.namespace) === canonicalizePath(candidate.namespace)) continue
      if (routeNamespacesIntersect(route.namespace, candidate.namespace))
        issues.push(
          `module route coordinates ${resolvePlatformModuleRoutePath(route.namespace)} and ${resolvePlatformModuleRoutePath(candidate.namespace)} overlap in module ${manifest.id}`,
        )
    }
  }
}

function routeNamespacesIntersect(left: string, right: string) {
  const leftSegments = left.split('/').filter(Boolean)
  const rightSegments = right.split('/').filter(Boolean)
  const sharedLength = Math.min(leftSegments.length, rightSegments.length)
  for (let index = 0; index < sharedLength; index += 1) {
    const leftSegment = leftSegments[index] ?? ''
    const rightSegment = rightSegments[index] ?? ''
    if (leftSegment === '*' || rightSegment === '*') return true
    if (
      !leftSegment.startsWith(':') &&
      !rightSegment.startsWith(':') &&
      leftSegment !== rightSegment
    )
      return false
  }
  return true
}

function validateManifestIdentity(
  manifest: PlatformModuleManifest,
  reservedModuleIds: ReadonlySet<string>,
  issues: string[],
) {
  if (!platformModuleIdPattern.test(manifest.id))
    issues.push(`module ID ${manifest.id} must be lowercase kebab-case`)
  if (manifest.id.length > platformModuleIdMaxLength)
    issues.push(`module ID ${manifest.id} must be at most ${platformModuleIdMaxLength} characters`)
  if (reservedModuleIds.has(manifest.id.toLowerCase()))
    issues.push(`module ID ${manifest.id} is reserved`)
  if (typeof manifest.defaultEnabled !== 'boolean')
    issues.push(`module ${manifest.id} must declare a boolean defaultEnabled value`)
}

function validatePackageNames(manifest: PlatformModuleManifest, issues: string[]) {
  const expectedServerPackage = `@eve-space/${manifest.id}-server`
  const expectedNuxtPackage = `@eve-space/${manifest.id}-nuxt`
  if (manifest.server.package !== expectedServerPackage)
    issues.push(`module ${manifest.id} server package must be ${expectedServerPackage}`)
  if (manifest.nuxt.package !== expectedNuxtPackage)
    issues.push(`module ${manifest.id} Nuxt package must be ${expectedNuxtPackage}`)
}

function validateContributionId(value: string, moduleId: string, kind: string, issues: string[]) {
  if (!platformContributionIdPattern.test(value))
    issues.push(`${kind} ${moduleId}/${value} must use a lowercase kebab-case ID`)
}

function validateExportName(value: string, moduleId: string, kind: string, issues: string[]) {
  if (!platformExportNamePattern.test(value))
    issues.push(`${kind} ${moduleId} export ${value} is not a valid JavaScript export name`)
}

function validateExposedContributions(manifest: PlatformModuleManifest, issues: string[]) {
  const exposed = manifest.nuxt.exposed
  if (!exposed) return
  const pascalId = manifest.id
    .split('-')
    .map((segment) => `${segment[0]?.toUpperCase() ?? ''}${segment.slice(1)}`)
    .join('')
  const prefixes = {
    components: `Eve${pascalId}`,
    composables: `useEve${pascalId}`,
    hooks: `eve-${manifest.id}:`,
    configurationKeys: `eve${pascalId}`,
    virtualFiles: `#eve-${manifest.id}/`,
  } as const

  for (const category of Object.keys(prefixes) as (keyof typeof prefixes)[]) {
    for (const value of exposed[category] ?? []) {
      if (!value.startsWith(prefixes[category]))
        issues.push(
          `module ${manifest.id} exposed ${category} value ${value} must begin with ${prefixes[category]}`,
        )
    }
  }
}

function validateUniqueValues(
  entries: readonly { value: string; owner: string }[],
  kind: string,
  issues: string[],
) {
  const values = new Map<string, string>()
  for (const entry of entries) claimValue(values, entry.value, entry.owner, kind, issues)
}

function createOwnedValues(values: readonly string[], owner: string) {
  return new Map(values.map((value) => [normalizeIdentity(value), owner]))
}

function claimValue(
  values: Map<string, string>,
  value: string,
  owner: string,
  kind: string,
  issues: string[],
) {
  const key = normalizeIdentity(value)
  const existingOwner = values.get(key)
  if (existingOwner) issues.push(`${kind} ${value} conflicts between ${existingOwner} and ${owner}`)
  else values.set(key, owner)
}

function normalizeIdentity(value: string) {
  return value.normalize('NFKC').toLowerCase()
}

function canonicalizePath(path: string) {
  return path.replace(/:[A-Za-z0-9_]+/g, ':parameter').replace(/\/$/, '') || '/'
}

function isNormalizedPath(path: string) {
  return (
    path.startsWith('/') &&
    path.length > 1 &&
    !path.endsWith('/') &&
    !path.includes('//') &&
    !path.includes('?') &&
    !path.includes('#') &&
    !path.split('/').some((segment) => segment === '.' || segment === '..')
  )
}

function compareStable(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
