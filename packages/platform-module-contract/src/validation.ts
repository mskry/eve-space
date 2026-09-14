import type { CoreDataContributionContext } from '@eve-space/core-data-contract'
import {
  platformAuthorizationStrategies,
  platformContributionIdPattern,
  platformExportNamePattern,
  platformIconTokens,
  platformMigrationFilenamePattern,
  platformModuleIdMaxLength,
  platformModuleIdPattern,
  platformNavigationAudiences,
  platformNavigationPlacements,
  platformOrganizationAudiences,
  platformPageExtensionPoints,
  platformPermissionKeyMaxLength,
  platformPermissionKeyPattern,
  platformResourceBatchModes,
  resolvePlatformModuleRoutePath,
  type PlatformModuleManifest,
  type PlatformResourceContribution,
} from './contract.js'
import {
  platformPersistenceOperationIdMaxLength,
  platformPersistenceOperationIdPattern,
  platformPersistenceOperationModes,
  type PlatformPersistenceOperationContribution,
  type PlatformPersistenceOperationMode,
  type PlatformPersistenceOperationReference,
} from './persistence.js'

export interface PlatformModuleValidationAuthorities {
  reservedModuleIds: readonly string[]
  navigationIds: readonly string[]
  esiOperationIds: readonly string[]
  coreDataProductContracts: Readonly<
    Record<
      string,
      {
        readonly audience: 'installed-module' | 'core'
        readonly sensitivity: 'public' | 'protected'
        readonly permittedContexts: readonly CoreDataContributionContext[]
      }
    >
  >
}

interface PersistenceReferenceValidationContext {
  readonly moduleId: string
  readonly operations: ReadonlyMap<string, PlatformPersistenceOperationContribution>
  readonly owners: ReadonlyMap<string, ReadonlySet<string>>
  readonly referenced: Set<string>
  readonly issues: string[]
}

export function compareStable(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export class PlatformModuleValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    const sortedIssues = issues.toSorted(compareStable)
    const issueList = sortedIssues.map((issue) => `- ${issue}`).join('\n')
    super(`Invalid platform module declarations:\n${issueList}`)
    this.name = 'PlatformModuleValidationError'
    this.issues = sortedIssues
  }
}

export function validatePlatformModuleManifests(
  manifests: readonly PlatformModuleManifest[],
  authorities: PlatformModuleValidationAuthorities,
): readonly PlatformModuleManifest[] {
  const issues: string[] = []
  const sorted = manifests.toSorted((left, right) => compareStable(left.id, right.id))

  const moduleIds = new Map<string, string>()
  const reservedModuleIds = new Set(authorities.reservedModuleIds.map((id) => id.toLowerCase()))
  const routeCoordinates = new Map<string, string>()
  const navigationIds = createOwnedValues(authorities.navigationIds, 'core')
  const esiOperationIds = createOwnedValues(authorities.esiOperationIds, 'core')
  const migrationIds = new Map<string, string>()
  const resourceIds = new Map<string, string>()
  const activityProviderIds = new Map<string, string>()
  const persistenceOperationOwners = indexPersistenceOperationOwners(sorted)

  for (const manifest of sorted)
    claimValue(moduleIds, manifest.id, manifest.id, 'module ID', issues)

  // Resources may reference an ESI operation declared by a module sorted after their own.
  for (const manifest of sorted)
    for (const operation of manifest.server.esiOperations)
      claimValue(esiOperationIds, operation.id, manifest.id, 'ESI operation ID', issues)

  for (const manifest of sorted) {
    validateManifestIdentity(manifest, reservedModuleIds, issues)
    validatePackageNames(manifest, issues)
    validateMember(
      manifest.icon,
      platformIconTokens,
      `module ${manifest.id} uses invalid default icon ${String(manifest.icon)}`,
      issues,
    )
    validateRouteNamespaceIntersections(manifest, issues)
    validateRoutes(manifest, routeCoordinates, authorities.coreDataProductContracts, issues)
    validateMigrations(manifest, migrationIds, issues)
    const persistenceOperations = validatePersistenceOperations(manifest, issues)
    validateEsiOperations(manifest, issues)
    validateResources(
      manifest,
      esiOperationIds,
      resourceIds,
      authorities.coreDataProductContracts,
      issues,
    )
    validateActivityProviders(
      manifest,
      activityProviderIds,
      authorities.coreDataProductContracts,
      issues,
    )
    validatePersistenceGrants(manifest, persistenceOperations, persistenceOperationOwners, issues)
    validatePages(manifest, issues)
    validateNavigation(manifest, navigationIds, issues)
    validateExposedContributions(manifest, issues)
  }

  if (issues.length > 0) throw new PlatformModuleValidationError(issues)
  return sorted
}

function indexPersistenceOperationOwners(manifests: readonly PlatformModuleManifest[]) {
  const owners = new Map<string, Set<string>>()
  for (const manifest of manifests)
    for (const operation of manifest.server.persistenceOperations) {
      if (typeof operation.id !== 'string') continue
      const key = normalizeIdentity(operation.id)
      const operationOwners = owners.get(key) ?? new Set<string>()
      operationOwners.add(manifest.id)
      owners.set(key, operationOwners)
    }
  return owners
}

function validatePersistenceOperations(
  manifest: PlatformModuleManifest,
  issues: string[],
): ReadonlyMap<string, PlatformPersistenceOperationContribution> {
  const operations = new Map<string, PlatformPersistenceOperationContribution>()
  const methods = new Map<string, string>()
  const exports = new Map<string, string>()
  const migrations = new Set(manifest.server.migrations.map(({ name }) => name))

  for (const operation of manifest.server.persistenceOperations) {
    const identity = `${manifest.id}/${String(operation.id)}`
    validatePersistenceOperationId(operation, identity, manifest.id, operations, issues)
    if (typeof operation.method !== 'string')
      issues.push(`persistence operation ${identity} must declare a method name`)
    else {
      validateExportName(operation.method, manifest.id, 'persistence operation method', issues)
      claimValue(methods, operation.method, identity, 'persistence operation method', issues)
    }
    if (typeof operation.exportName !== 'string')
      issues.push(`persistence operation ${identity} must declare a definition export`)
    else {
      validateExportName(operation.exportName, manifest.id, 'persistence operation', issues)
      claimValue(exports, operation.exportName, identity, 'persistence definition export', issues)
    }
    if (!Number.isSafeInteger(operation.revision) || operation.revision < 1)
      issues.push(`persistence operation ${identity} must use a positive whole revision`)
    validateMember(
      operation.mode,
      platformPersistenceOperationModes,
      `persistence operation ${identity} uses unsupported mode ${String(operation.mode)}`,
      issues,
    )
    if (typeof operation.migration !== 'string' || !migrations.has(operation.migration))
      issues.push(
        `persistence operation ${identity} references undeclared migration ${String(operation.migration)}`,
      )
  }
  return operations
}

function validatePersistenceOperationId(
  operation: PlatformPersistenceOperationContribution,
  identity: string,
  moduleId: string,
  operations: Map<string, PlatformPersistenceOperationContribution>,
  issues: string[],
) {
  if (
    typeof operation.id !== 'string' ||
    !platformPersistenceOperationIdPattern.test(operation.id) ||
    operation.id.length > platformPersistenceOperationIdMaxLength
  ) {
    issues.push(`persistence operation ${identity} must use a bounded lowercase kebab-case ID`)
    return
  }
  const key = normalizeIdentity(operation.id)
  if (operations.has(key))
    issues.push(`persistence operation ID ${operation.id} is duplicated in ${moduleId}`)
  else operations.set(key, operation)
}

function validatePersistenceGrants(
  manifest: PlatformModuleManifest,
  operations: ReadonlyMap<string, PlatformPersistenceOperationContribution>,
  owners: ReadonlyMap<string, ReadonlySet<string>>,
  issues: string[],
) {
  const referenced = new Set<string>()
  const validationContext: PersistenceReferenceValidationContext = {
    moduleId: manifest.id,
    operations,
    owners,
    referenced,
    issues,
  }
  for (const route of manifest.server.routes)
    validatePersistenceReferences(
      route.persistenceOperations,
      `route ${manifest.id}/${route.id}`,
      undefined,
      validationContext,
    )
  for (const provider of manifest.server.activityProviders)
    validatePersistenceReferences(
      provider.persistenceOperations,
      `activity provider ${manifest.id}/${provider.id}`,
      'read',
      validationContext,
    )
  for (const resource of manifest.server.resources) {
    validatePersistenceReferences(
      resource.persistence?.projection,
      `resource projection ${manifest.id}/${resource.id}`,
      'read',
      validationContext,
    )
    validatePersistenceReferences(
      resource.persistence?.materialization,
      `resource materialization ${manifest.id}/${resource.id}`,
      'write',
      validationContext,
    )
  }
  for (const [operationId, operation] of operations)
    if (!referenced.has(operationId))
      issues.push(
        `persistence operation ${manifest.id}/${operation.id} is not granted to a contribution`,
      )
}

function validatePersistenceReferences(
  value: unknown,
  identity: string,
  expectedMode: PlatformPersistenceOperationMode | undefined,
  context: PersistenceReferenceValidationContext,
) {
  const { moduleId, operations, owners, referenced, issues } = context
  if (!Array.isArray(value)) {
    issues.push(`${identity} persistence operations must be an array`)
    return
  }
  const seen = new Set<string>()
  for (const reference of value as readonly PlatformPersistenceOperationReference[]) {
    if (!isRecord(reference) || typeof reference.operationId !== 'string') {
      issues.push(`${identity} contains an invalid persistence operation reference`)
      continue
    }
    const key = normalizeIdentity(reference.operationId)
    if (seen.has(key)) {
      issues.push(`${identity} declares duplicate persistence operation ${reference.operationId}`)
      continue
    }
    seen.add(key)
    const operation = operations.get(key)
    if (!operation) {
      const foreignOwners = [...(owners.get(key) ?? [])].filter((owner) => owner !== moduleId)
      issues.push(
        foreignOwners.length > 0
          ? `${identity} references cross-module persistence operation ${reference.operationId} owned by ${foreignOwners.toSorted(compareStable).join(', ')}`
          : `${identity} references unknown persistence operation ${reference.operationId}`,
      )
      continue
    }
    referenced.add(key)
    if (expectedMode && operation.mode !== expectedMode)
      issues.push(
        `${identity} cannot use ${operation.mode} persistence operation ${reference.operationId}; expected ${expectedMode}`,
      )
  }
}

function validateRoutes(
  manifest: PlatformModuleManifest,
  routeCoordinates: Map<string, string>,
  productContracts: PlatformModuleValidationAuthorities['coreDataProductContracts'],
  issues: string[],
) {
  const moduleNamespace = `/${manifest.id}`
  for (const route of manifest.server.routes) {
    const identity = `${manifest.id}/${route.id}`
    validateContributionId(route.id, manifest.id, 'route', issues)
    validateExportName(route.exportName, manifest.id, 'route', issues)
    if (route.namespace !== moduleNamespace && !route.namespace.startsWith(`${moduleNamespace}/`))
      issues.push(
        `route ${identity} namespace must be ${moduleNamespace} or begin with ${moduleNamespace}/`,
      )
    if (!isNormalizedPath(route.namespace))
      issues.push(`route ${identity} has invalid namespace ${route.namespace}`)
    claimValue(
      routeCoordinates,
      canonicalizePath(resolvePlatformModuleRoutePath(route.namespace)),
      manifest.id,
      'module route coordinate',
      issues,
    )
    validateMember(
      route.authorization,
      platformAuthorizationStrategies,
      `route ${identity} uses unsupported authorization ${String(route.authorization)}`,
      issues,
    )
    validateOrganizationAuthorization(route, `route ${identity}`, issues)
    validateCoreDataProducts(route, `route ${identity}`, 'route', productContracts, issues)
    if (
      route.authorization === 'owned-character' &&
      !route.namespace.split('/').includes(':characterId')
    )
      issues.push(`owned-character route ${identity} must include :characterId in its namespace`)
  }
}

function validateActivityProviders(
  manifest: PlatformModuleManifest,
  providerIds: Map<string, string>,
  productContracts: PlatformModuleValidationAuthorities['coreDataProductContracts'],
  issues: string[],
) {
  for (const provider of manifest.server.activityProviders) {
    const identity = `${manifest.id}/${provider.id}`
    validateContributionId(provider.id, manifest.id, 'activity provider', issues)
    validateExportName(provider.exportName, manifest.id, 'activity provider', issues)
    validateOrganizationAuthorization(provider, `activity provider ${identity}`, issues)
    validateCoreDataProducts(
      provider,
      `activity provider ${identity}`,
      'activity-provider',
      productContracts,
      issues,
    )
    claimValue(providerIds, identity, manifest.id, 'activity provider identity', issues)
    if (
      !Number.isSafeInteger(provider.freshness?.staleAfterSeconds) ||
      provider.freshness.staleAfterSeconds <= 0
    )
      issues.push(`activity provider ${identity} must use a positive whole stale interval`)
  }
}

function validateMigrations(
  manifest: PlatformModuleManifest,
  migrationIds: Map<string, string>,
  issues: string[],
) {
  for (const migration of manifest.server.migrations) {
    const identity = `${manifest.id}/${migration.name}`
    if (!migration.name.startsWith(`${manifest.id}-`) || !migration.name.endsWith('.sql'))
      issues.push(`migration ${identity} must use ${manifest.id}-*.sql`)
    if (!platformMigrationFilenamePattern.test(migration.name))
      issues.push(`migration ${identity} must be a package-local filename`)
    claimValue(migrationIds, identity, manifest.id, 'migration identity', issues)
  }
}

function validateEsiOperations(manifest: PlatformModuleManifest, issues: string[]) {
  for (const operation of manifest.server.esiOperations) {
    validateContributionId(operation.id, manifest.id, 'ESI operation', issues)
    validateExportName(operation.exportName, manifest.id, 'ESI operation', issues)
  }
}

function validateResources(
  manifest: PlatformModuleManifest,
  esiOperationIds: ReadonlyMap<string, string>,
  resourceIds: Map<string, string>,
  productContracts: PlatformModuleValidationAuthorities['coreDataProductContracts'],
  issues: string[],
) {
  const eligibilityBySubject = {
    deployment: 'current-deployment',
    character: 'current-owned-character',
    corporation: 'current-managed-corporation-source',
    alliance: 'current-managed-alliance',
  } as const
  const eligibilityKinds = Object.values(eligibilityBySubject)
  for (const resource of manifest.server.resources) {
    const identity = `${manifest.id}/${resource.id}`
    validateContributionId(resource.id, manifest.id, 'resource', issues)
    validateExportName(resource.exportName, manifest.id, 'resource', issues)
    claimValue(resourceIds, resource.id, manifest.id, 'resource ID', issues)
    const expectedEligibility = Object.hasOwn(eligibilityBySubject, resource.subjectKind)
      ? eligibilityBySubject[resource.subjectKind]
      : undefined
    if (!expectedEligibility)
      issues.push(
        `resource ${identity} uses unsupported subject kind ${String(resource.subjectKind)}`,
      )
    if (
      !Number.isSafeInteger(resource.materializationIntervalSeconds) ||
      resource.materializationIntervalSeconds <= 0
    )
      issues.push(`resource ${identity} must use a positive whole interval`)
    const eligibilityKind = resource.eligibility?.kind
    if (!eligibilityKinds.includes(eligibilityKind as never))
      issues.push(`resource ${identity} uses unsupported eligibility ${String(eligibilityKind)}`)
    else if (expectedEligibility && eligibilityKind !== expectedEligibility)
      issues.push(
        `resource ${identity} eligibility ${String(eligibilityKind)} is incompatible with subject kind ${String(resource.subjectKind)}; expected ${expectedEligibility}`,
      )
    if (!esiOperationIds.has(normalizeIdentity(resource.operationId)))
      issues.push(`resource ${identity} references unknown ESI operation ${resource.operationId}`)
    validateDependentEsiOperations(manifest, resource, identity, issues)
    validateResourceBatch(resource, identity, esiOperationIds, issues)
    validateCoreDataProducts(
      resource,
      `resource ${identity}`,
      'resource-projection',
      productContracts,
      issues,
    )
  }
}

function validateCoreDataProducts(
  contribution: { readonly coreDataProducts?: unknown },
  identity: string,
  context: CoreDataContributionContext,
  productContracts: PlatformModuleValidationAuthorities['coreDataProductContracts'],
  issues: string[],
) {
  const products = contribution.coreDataProducts
  if (products === undefined) return
  if (!Array.isArray(products)) {
    issues.push(`${identity} core-data products must be an array`)
    return
  }
  const seen = new Set<string>()
  for (const product of products) {
    if (typeof product !== 'string' || !Object.hasOwn(productContracts, product)) {
      issues.push(`${identity} references unknown core-data product ${String(product)}`)
      continue
    }
    if (seen.has(product)) {
      issues.push(`${identity} declares duplicate core-data product ${product}`)
      continue
    }
    seen.add(product)
    const contract = productContracts[product]!
    if (contract.sensitivity !== 'public')
      issues.push(`${identity} cannot declare protected core-data product ${product}`)
    if (contract.audience !== 'installed-module')
      issues.push(`${identity} has incompatible audience for core-data product ${product}`)
    if (!(contract.permittedContexts as readonly CoreDataContributionContext[]).includes(context))
      issues.push(`${identity} cannot use core-data product ${product} in ${context}`)
  }
}

function validateDependentEsiOperations(
  manifest: PlatformModuleManifest,
  resource: PlatformResourceContribution,
  identity: string,
  issues: string[],
) {
  for (const operationId of resource.dependentOperationIds ?? [])
    if (!manifest.server.esiOperations.some((operation) => operation.id === operationId))
      issues.push(
        `resource ${identity} references undeclared dependent ESI operation ${operationId}`,
      )
}

function validateResourceBatch(
  resource: PlatformResourceContribution,
  identity: string,
  esiOperationIds: ReadonlyMap<string, string>,
  issues: string[],
) {
  if (resource.batch === undefined) return
  if (Array.isArray(resource.coreDataProducts) && resource.coreDataProducts.length > 0)
    issues.push(`resource ${identity} cannot declare core-data products with batch execution`)
  if (resource.subjectKind !== 'character')
    issues.push(`resource ${identity} may only declare a batch for character subjects`)
  validateMember(
    resource.batch.mode,
    platformResourceBatchModes,
    `resource ${identity} uses unsupported batch mode ${String(resource.batch.mode)}`,
    issues,
  )
  if (!esiOperationIds.has(normalizeIdentity(resource.batch.operationId)))
    issues.push(
      `resource ${identity} references unknown batch ESI operation ${resource.batch.operationId}`,
    )
}

function validatePages(manifest: PlatformModuleManifest, issues: string[]) {
  for (const page of manifest.nuxt.pages) {
    const identity = `${manifest.id}/${page.id}`
    validateContributionId(page.id, manifest.id, 'page', issues)
    if (!page.name.startsWith(`eve-${manifest.id}-`))
      issues.push(`page ${identity} name must begin with eve-${manifest.id}-`)
    if (!isNormalizedPath(page.path)) issues.push(`page ${identity} has invalid path ${page.path}`)
    if (
      !page.file.startsWith('src/runtime/app/pages/') ||
      !page.file.endsWith('.vue') ||
      page.file.split('/').some((segment) => segment === '.' || segment === '..')
    )
      issues.push(`page ${identity} file must be a Vue file under src/runtime/app/pages`)
    validateMember(
      page.extensionPoint,
      platformPageExtensionPoints,
      `page ${identity} uses unsupported extension point ${String(page.extensionPoint)}`,
      issues,
    )
    validateMember(
      page.audience,
      platformNavigationAudiences,
      `page ${identity} uses unsupported audience ${String(page.audience)}`,
      issues,
    )
  }
}

function validateNavigation(
  manifest: PlatformModuleManifest,
  navigationIds: Map<string, string>,
  issues: string[],
) {
  for (const navigation of manifest.nuxt.navigation) {
    const identity = `${manifest.id}/${navigation.id}`
    validateContributionId(navigation.id, manifest.id, 'navigation', issues)
    if (navigation.icon !== undefined)
      validateMember(
        navigation.icon,
        platformIconTokens,
        `navigation ${identity} uses invalid icon ${String(navigation.icon)}`,
        issues,
      )
    validateMember(
      navigation.audience,
      platformNavigationAudiences,
      `navigation ${identity} uses unsupported audience ${String(navigation.audience)}`,
      issues,
    )
    validateMember(
      navigation.placement,
      platformNavigationPlacements,
      `navigation ${identity} uses unsupported placement ${String(navigation.placement)}`,
      issues,
    )
    if (!Number.isSafeInteger(navigation.order))
      issues.push(`navigation ${identity} order must be a safe integer`)
    if (!manifest.nuxt.pages.some((page) => page.name === navigation.pageName))
      issues.push(`navigation ${identity} references undeclared page ${navigation.pageName}`)
    claimValue(navigationIds, navigation.id, manifest.id, 'navigation ID', issues)
  }
}

function validateRouteNamespaceIntersections(manifest: PlatformModuleManifest, issues: string[]) {
  const routes = manifest.server.routes.map((route) => ({
    namespace: route.namespace,
    canonical: canonicalizePath(route.namespace),
    segments: route.namespace.split('/').filter(Boolean),
  }))
  for (const [index, route] of routes.entries()) {
    for (const candidate of routes.slice(index + 1)) {
      if (route.canonical === candidate.canonical) continue
      if (routeSegmentsIntersect(route.segments, candidate.segments))
        issues.push(
          `module route coordinates ${resolvePlatformModuleRoutePath(route.namespace)} and ${resolvePlatformModuleRoutePath(candidate.namespace)} overlap in module ${manifest.id}`,
        )
    }
  }
}

function routeSegmentsIntersect(left: readonly string[], right: readonly string[]) {
  const sharedLength = Math.min(left.length, right.length)
  for (let index = 0; index < sharedLength; index += 1) {
    const leftSegment = left[index] ?? ''
    const rightSegment = right[index] ?? ''
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

function validateOrganizationAuthorization(
  contribution: { readonly audience: unknown; readonly requiredPermission: unknown },
  identity: string,
  issues: string[],
) {
  if (!platformOrganizationAudiences.includes(contribution.audience as never))
    issues.push(
      `${identity} uses unsupported organization audience ${String(contribution.audience)}`,
    )
  if (!isValidPermissionKey(contribution.requiredPermission))
    issues.push(`${identity} must declare a valid required permission`)
}

function isValidPermissionKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= platformPermissionKeyMaxLength &&
    platformPermissionKeyPattern.test(value) &&
    value.split(/[.:]/).every((segment) => segment.length > 0 && !segment.endsWith('-'))
  )
}

function validateMember(
  value: string,
  allowed: readonly string[],
  message: string,
  issues: string[],
) {
  if (!allowed.includes(value)) issues.push(message)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalizePath(path: string) {
  return path.replace(/:\w+/g, ':parameter').replace(/\/$/, '') || '/'
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
