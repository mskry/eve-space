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
  platformPageExtensionPoints,
  platformResourceBatchModes,
  resolvePlatformModuleRoutePath,
  type PlatformModuleManifest,
} from './contract.js'

export interface PlatformModuleValidationAuthorities {
  reservedModuleIds: readonly string[]
  navigationIds: readonly string[]
  esiOperationIds: readonly string[]
}

export function compareStable(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
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
  const sorted = manifests.toSorted((left, right) => compareStable(left.id, right.id))

  const moduleIds = new Map<string, string>()
  const reservedModuleIds = new Set(authorities.reservedModuleIds.map((id) => id.toLowerCase()))
  const routeCoordinates = new Map<string, string>()
  const navigationIds = createOwnedValues(authorities.navigationIds, 'core')
  const esiOperationIds = createOwnedValues(authorities.esiOperationIds, 'core')
  const migrationIds = new Map<string, string>()
  const resourceIds = new Map<string, string>()

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
    validateRoutes(manifest, routeCoordinates, issues)
    validateMigrations(manifest, migrationIds, issues)
    validateEsiOperations(manifest, issues)
    validateResources(manifest, esiOperationIds, resourceIds, issues)
    validatePages(manifest, issues)
    validateNavigation(manifest, navigationIds, issues)
    validateExposedContributions(manifest, issues)
  }

  if (issues.length > 0) throw new PlatformModuleValidationError(issues)
  return sorted
}

function validateRoutes(
  manifest: PlatformModuleManifest,
  routeCoordinates: Map<string, string>,
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
    if (
      route.authorization === 'owned-character' &&
      !route.namespace.split('/').includes(':characterId')
    )
      issues.push(`owned-character route ${identity} must include :characterId in its namespace`)
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
  issues: string[],
) {
  for (const resource of manifest.server.resources) {
    const identity = `${manifest.id}/${resource.id}`
    validateContributionId(resource.id, manifest.id, 'resource', issues)
    validateExportName(resource.exportName, manifest.id, 'resource', issues)
    claimValue(resourceIds, resource.id, manifest.id, 'resource ID', issues)
    if (resource.subjectKind !== 'character')
      issues.push(
        `resource ${identity} uses unsupported initial subject kind ${String(resource.subjectKind)}`,
      )
    if (
      !Number.isSafeInteger(resource.materializationIntervalSeconds) ||
      resource.materializationIntervalSeconds <= 0
    )
      issues.push(`resource ${identity} must use a positive whole interval`)
    if (resource.eligibility?.kind !== 'current-owned-character')
      issues.push(
        `resource ${identity} uses unsupported eligibility ${String(resource.eligibility?.kind)}`,
      )
    if (!esiOperationIds.has(normalizeIdentity(resource.operationId)))
      issues.push(`resource ${identity} references unknown ESI operation ${resource.operationId}`)
    if (resource.batch === undefined) continue
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
