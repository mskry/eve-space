import type { CoreDataContributionContext } from '@eve-space/core-data-contract'
import {
  isPlatformContributionId,
  isPlatformExportName,
  isPlatformMigrationFilename,
  isPlatformPermissionKey,
  platformModuleIdIssues,
  platformPersistenceOperationIdIssues,
} from './identifiers.js'
import type { PlatformModuleManifest } from './manifest.js'
import {
  platformNavigationAudiences,
  platformNavigationPlacements,
  platformPageExtensionPoints,
  platformIconTokens,
} from './nuxt.js'
import {
  platformPersistenceOperationModes,
  type PlatformPersistenceOperationContribution,
  type PlatformPersistenceOperationMode,
  type PlatformPersistenceOperationReference,
} from './persistence.js'
import { platformResourceBatchModes, type PlatformResourceContribution } from './resources.js'
import {
  platformAuthorizationStrategies,
  platformModuleSectionKinds,
  platformOrganizationAudiences,
  platformOrganizationCommandIds,
  platformRouteExposures,
  platformRouteTargets,
  resolvePlatformModuleRoutePath,
  type PlatformModuleSectionContribution,
} from './server.js'

const resourceEligibilityBySubject = {
  deployment: 'current-deployment',
  corporation: 'current-managed-corporation-source',
  alliance: 'current-managed-alliance',
} as const
const characterResourceEligibilityKinds = new Set([
  'current-owned-character',
  'current-managed-member-character',
] as const)
const resourceEligibilityKinds = new Set([
  ...Object.values(resourceEligibilityBySubject),
  ...characterResourceEligibilityKinds,
])

type PlatformRouteContribution = PlatformModuleManifest['server']['routes'][number]

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

export function validatePlatformModuleCandidates<
  Candidate extends { readonly manifest: PlatformModuleManifest },
>(
  candidates: readonly Candidate[],
  authorities: PlatformModuleValidationAuthorities,
): readonly Candidate[] {
  const issues: string[] = []
  const sortedCandidates = candidates.toSorted((left, right) =>
    compareStable(left.manifest.id, right.manifest.id),
  )
  const sorted = sortedCandidates.map(({ manifest }) => manifest)

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
    const sections = validateSections(manifest, issues)
    validateMember(
      manifest.icon,
      platformIconTokens,
      `module ${manifest.id} uses invalid default icon ${String(manifest.icon)}`,
      issues,
    )
    validateRouteNamespaceIntersections(manifest, issues)
    validateRoutes(
      manifest,
      sections,
      routeCoordinates,
      authorities.coreDataProductContracts,
      issues,
    )
    validateMigrations(manifest, migrationIds, issues)
    const persistenceOperations = validatePersistenceOperations(manifest, issues)
    validateEsiOperations(manifest, issues)
    validateResources(
      manifest,
      sections,
      esiOperationIds,
      resourceIds,
      authorities.coreDataProductContracts,
      issues,
    )
    validateActivityProviders(
      manifest,
      sections,
      activityProviderIds,
      authorities.coreDataProductContracts,
      issues,
    )
    validatePersistenceGrants(manifest, persistenceOperations, persistenceOperationOwners, issues)
    validatePages(manifest, sections, issues)
    validateNavigation(manifest, sections, navigationIds, issues)
    validateExposedContributions(manifest, issues)
  }

  if (issues.length > 0) throw new PlatformModuleValidationError(issues)
  return sortedCandidates
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
    platformPersistenceOperationIdIssues(operation.id).length > 0
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
  const { operations, referenced, issues } = context
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
      reportMissingPersistenceOperation(reference.operationId, key, identity, context)
      continue
    }
    referenced.add(key)
    if (expectedMode && operation.mode !== expectedMode)
      issues.push(
        `${identity} cannot use ${operation.mode} persistence operation ${reference.operationId}; expected ${expectedMode}`,
      )
  }
}

function reportMissingPersistenceOperation(
  operationId: string,
  key: string,
  identity: string,
  context: PersistenceReferenceValidationContext,
) {
  const foreignOwners = [...(context.owners.get(key) ?? [])].filter(
    (owner) => owner !== context.moduleId,
  )
  if (foreignOwners.length > 0) {
    context.issues.push(
      `${identity} references cross-module persistence operation ${operationId} owned by ${foreignOwners.toSorted(compareStable).join(', ')}`,
    )
    return
  }
  context.issues.push(`${identity} references unknown persistence operation ${operationId}`)
}

function validateRoutes(
  manifest: PlatformModuleManifest,
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  routeCoordinates: Map<string, string>,
  productContracts: PlatformModuleValidationAuthorities['coreDataProductContracts'],
  issues: string[],
) {
  for (const route of manifest.server.routes)
    validateRoute(manifest, sections, route, routeCoordinates, productContracts, issues)
}

function validateRoute(
  manifest: PlatformModuleManifest,
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  route: PlatformRouteContribution,
  routeCoordinates: Map<string, string>,
  productContracts: PlatformModuleValidationAuthorities['coreDataProductContracts'],
  issues: string[],
) {
  const identity = `${manifest.id}/${route.id}`
  validateContributionId(route.id, manifest.id, 'route', issues)
  validateExportName(route.exportName, manifest.id, 'route', issues)
  validateRouteNamespace(manifest.id, route, identity, routeCoordinates, issues)
  validateMember(
    route.authorization,
    platformAuthorizationStrategies,
    `route ${identity} uses unsupported authorization ${String(route.authorization)}`,
    issues,
  )
  validateOrganizationAuthorization(route, `route ${identity}`, issues)
  const section = validateContributionSection(
    manifest,
    sections,
    route,
    `route ${identity}`,
    issues,
  )
  validateClassification(
    route.target,
    platformRouteTargets,
    `route ${identity} uses unsupported target classification ${String(route.target)}`,
    manifest.sections === undefined,
    issues,
  )
  validateClassification(
    route.exposure,
    platformRouteExposures,
    `route ${identity} uses unsupported exposure classification ${String(route.exposure)}`,
    manifest.sections === undefined,
    issues,
  )
  validateManagedReviewerRoute(route, manifest.id, identity, issues)
  validateRouteExposure(route, section, manifest.id, identity, issues)
  validateOrganizationCommands(
    route.organizationCommands,
    manifest.id,
    route.target,
    section,
    route.requiredPermission,
    identity,
    issues,
  )
  validateCoreDataProducts(route, `route ${identity}`, 'route', productContracts, issues)
  validateOwnedCharacterRoute(route, identity, issues)
}

function validateRouteNamespace(
  moduleId: string,
  route: PlatformRouteContribution,
  identity: string,
  routeCoordinates: Map<string, string>,
  issues: string[],
) {
  const moduleNamespace = `/${moduleId}`
  if (route.namespace !== moduleNamespace && !route.namespace.startsWith(`${moduleNamespace}/`))
    issues.push(
      `route ${identity} namespace must be ${moduleNamespace} or begin with ${moduleNamespace}/`,
    )
  if (!isNormalizedPath(route.namespace))
    issues.push(`route ${identity} has invalid namespace ${route.namespace}`)
  claimValue(
    routeCoordinates,
    canonicalizePath(resolvePlatformModuleRoutePath(route.namespace)),
    moduleId,
    'module route coordinate',
    issues,
  )
}

function validateManagedReviewerRoute(
  route: PlatformRouteContribution,
  moduleId: string,
  identity: string,
  issues: string[],
) {
  const managedReviewerTarget = route.target !== undefined && route.target !== 'caller'
  if (managedReviewerTarget && route.authorization !== 'authenticated-session')
    issues.push(`managed reviewer route ${identity} must use authenticated-session authorization`)
  if (managedReviewerTarget && route.audience === 'member')
    issues.push(`managed reviewer route ${identity} must require an HR or director audience`)
  validateManagedReviewerSearchRoute(route, moduleId, identity, issues)
  if (managedReviewerTarget && (route.persistenceOperations?.length ?? 0) > 0)
    issues.push(
      `managed reviewer route ${identity} cannot receive generic route persistence; use a target-bound platform capability`,
    )
  validateManagedReviewerRouteParameters(route, identity, issues)
}

function validateManagedReviewerSearchRoute(
  route: PlatformRouteContribution,
  moduleId: string,
  identity: string,
  issues: string[],
) {
  if (route.target !== 'managed-organization-account-search') return
  if ((route.additionalRequiredPermissions?.length ?? 0) === 0)
    issues.push(`managed reviewer search route ${identity} must require a summary permission`)
  if (route.requiredPermission !== `${moduleId}.search`)
    issues.push(`managed reviewer search route ${identity} must require ${moduleId}.search`)
  if (!route.additionalRequiredPermissions?.includes(`${moduleId}.summary.read`))
    issues.push(
      `managed reviewer search route ${identity} must additionally require ${moduleId}.summary.read`,
    )
}

function validateManagedReviewerRouteParameters(
  route: PlatformRouteContribution,
  identity: string,
  issues: string[],
) {
  const namespaceSegments = new Set(route.namespace.split('/'))
  if (
    (route.target === 'managed-organization-account' ||
      route.target === 'managed-organization-character') &&
    !namespaceSegments.has(':userId')
  )
    issues.push(`managed reviewer route ${identity} must include :userId in its namespace`)
  if (route.target === 'managed-organization-character' && !namespaceSegments.has(':characterId'))
    issues.push(
      `managed reviewer character route ${identity} must include :characterId in its namespace`,
    )
}

function validateRouteExposure(
  route: PlatformRouteContribution,
  section: PlatformModuleSectionContribution | undefined,
  moduleId: string,
  identity: string,
  issues: string[],
) {
  if (route.exposure === 'sensitive-evidence') {
    validateSensitiveRouteExposure(route, section, moduleId, identity, issues)
    return
  }
  if (section?.kind === 'sensitive-evidence')
    issues.push(`route ${identity} in a sensitive-evidence section must declare sensitive exposure`)
}

function validateSensitiveRouteExposure(
  route: PlatformRouteContribution,
  section: PlatformModuleSectionContribution | undefined,
  moduleId: string,
  identity: string,
  issues: string[],
) {
  if (section?.kind !== 'sensitive-evidence')
    issues.push(`sensitive route ${identity} must use a sensitive-evidence section`)
  if (
    route.target !== 'managed-organization-account' &&
    route.target !== 'managed-organization-character'
  )
    issues.push(`sensitive route ${identity} must declare a managed reviewer target`)
  if (section && route.requiredPermission !== `${moduleId}.${section.id}.read`)
    issues.push(`sensitive route ${identity} must require ${moduleId}.${section.id}.read`)
}

function validateOwnedCharacterRoute(
  route: PlatformRouteContribution,
  identity: string,
  issues: string[],
) {
  if (
    route.authorization === 'owned-character' &&
    !route.namespace.split('/').includes(':characterId')
  )
    issues.push(`owned-character route ${identity} must include :characterId in its namespace`)
}

function validateOrganizationCommands(
  value: unknown,
  moduleId: string,
  target: unknown,
  section: PlatformModuleSectionContribution | undefined,
  requiredPermission: string,
  identity: string,
  issues: string[],
) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`route ${identity} organization commands must be a non-empty array`)
    return
  }
  if (moduleId !== 'member-audit')
    issues.push(`route ${identity} organization commands are reserved for module member-audit`)
  const commandIds = collectOrganizationCommandIds(value, identity, issues)
  if (target !== 'managed-organization-account' && target !== 'managed-organization-character')
    issues.push(`route ${identity} organization commands require a managed reviewer target`)
  if (section?.kind !== 'access-management')
    issues.push(`route ${identity} organization commands require an access-management section`)
  validateOrganizationCommandPermissions(commandIds, requiredPermission, identity, issues)
}

function collectOrganizationCommandIds(
  value: readonly unknown[],
  identity: string,
  issues: string[],
) {
  const commandIds = new Set<string>()
  for (const commandId of value) {
    if (
      typeof commandId !== 'string' ||
      !(platformOrganizationCommandIds as readonly string[]).includes(commandId)
    ) {
      issues.push(
        `route ${identity} declares unsupported organization command ${String(commandId)}`,
      )
      continue
    }
    if (commandIds.has(commandId))
      issues.push(`route ${identity} declares duplicate organization command ${commandId}`)
    else commandIds.add(commandId)
  }
  return commandIds
}

function validateOrganizationCommandPermissions(
  commandIds: ReadonlySet<string>,
  requiredPermission: string,
  identity: string,
  issues: string[],
) {
  const requiredPermissions = new Set([...commandIds].map(organizationCommandPermission))
  if (requiredPermissions.size > 1)
    issues.push(`route ${identity} cannot mix organization commands with different permissions`)
  else {
    const [commandPermission] = requiredPermissions
    if (commandPermission && commandPermission !== requiredPermission)
      issues.push(`route ${identity} organization commands require permission ${commandPermission}`)
  }
}

function organizationCommandPermission(commandId: string) {
  switch (commandId) {
    case 'assign-ordinary-group':
    case 'revoke-ordinary-group':
      return 'member-audit.groups.manage'
    default:
      return 'member-audit.members.block'
  }
}

function validateActivityProviders(
  manifest: PlatformModuleManifest,
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  providerIds: Map<string, string>,
  productContracts: PlatformModuleValidationAuthorities['coreDataProductContracts'],
  issues: string[],
) {
  for (const provider of manifest.server.activityProviders) {
    const identity = `${manifest.id}/${provider.id}`
    validateContributionId(provider.id, manifest.id, 'activity provider', issues)
    validateExportName(provider.exportName, manifest.id, 'activity provider', issues)
    validateOrganizationAuthorization(provider, `activity provider ${identity}`, issues)
    const section = validateContributionSection(
      manifest,
      sections,
      provider,
      `activity provider ${identity}`,
      issues,
    )
    if (section?.kind === 'sensitive-evidence')
      issues.push(
        `activity provider ${identity} cannot expose a sensitive-evidence section outside an audited reviewer route`,
      )
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
    if (!isPlatformMigrationFilename(migration.name))
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
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  esiOperationIds: ReadonlyMap<string, string>,
  resourceIds: Map<string, string>,
  productContracts: PlatformModuleValidationAuthorities['coreDataProductContracts'],
  issues: string[],
) {
  for (const resource of manifest.server.resources)
    validateResource(
      manifest,
      sections,
      resource,
      esiOperationIds,
      resourceIds,
      productContracts,
      issues,
    )
}

function validateResource(
  manifest: PlatformModuleManifest,
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  resource: PlatformResourceContribution,
  esiOperationIds: ReadonlyMap<string, string>,
  resourceIds: Map<string, string>,
  productContracts: PlatformModuleValidationAuthorities['coreDataProductContracts'],
  issues: string[],
) {
  const identity = `${manifest.id}/${resource.id}`
  validateContributionId(resource.id, manifest.id, 'resource', issues)
  validateExportName(resource.exportName, manifest.id, 'resource', issues)
  const section = validateContributionSection(
    manifest,
    sections,
    resource,
    `resource ${identity}`,
    issues,
  )
  if (manifest.sections !== undefined && section?.kind !== 'sensitive-evidence')
    issues.push(`resource ${identity} must use a sensitive-evidence section`)
  claimValue(resourceIds, resource.id, manifest.id, 'resource ID', issues)
  const expectedEligibility = validateResourceSubjectKind(resource, identity, issues)
  validateResourceMaterializationInterval(resource, identity, issues)
  validateResourceEligibility(resource, section, expectedEligibility, identity, issues)
  if (!esiOperationIds.has(normalizeIdentity(resource.operationId)))
    issues.push(`resource ${identity} references unknown ESI operation ${resource.operationId}`)
  validateDependentEsiOperations(resource, identity, esiOperationIds, issues)
  validateResourceBatch(resource, identity, esiOperationIds, issues)
  validateCoreDataProducts(
    resource,
    `resource ${identity}`,
    'resource-projection',
    productContracts,
    issues,
  )
}

function validateResourceSubjectKind(
  resource: PlatformResourceContribution,
  identity: string,
  issues: string[],
) {
  if (resource.subjectKind === 'character') return undefined
  const expectedEligibility = resourceEligibilityBySubject[resource.subjectKind]
  if (!expectedEligibility)
    issues.push(
      `resource ${identity} uses unsupported subject kind ${String(resource.subjectKind)}`,
    )
  return expectedEligibility
}

function validateResourceMaterializationInterval(
  resource: PlatformResourceContribution,
  identity: string,
  issues: string[],
) {
  if (
    !Number.isSafeInteger(resource.materializationIntervalSeconds) ||
    resource.materializationIntervalSeconds <= 0
  )
    issues.push(`resource ${identity} must use a positive whole interval`)
}

function validateResourceEligibility(
  resource: PlatformResourceContribution,
  section: PlatformModuleSectionContribution | undefined,
  expectedEligibility:
    | (typeof resourceEligibilityBySubject)[keyof typeof resourceEligibilityBySubject]
    | undefined,
  identity: string,
  issues: string[],
) {
  const eligibilityKind = resource.eligibility?.kind
  if (!resourceEligibilityKinds.has(eligibilityKind as never))
    issues.push(`resource ${identity} uses unsupported eligibility ${String(eligibilityKind)}`)
  else if (
    resource.subjectKind === 'character' &&
    !characterResourceEligibilityKinds.has(eligibilityKind as never)
  )
    issues.push(
      `resource ${identity} eligibility ${String(eligibilityKind)} is incompatible with subject kind character`,
    )
  else if (expectedEligibility && eligibilityKind !== expectedEligibility)
    issues.push(
      `resource ${identity} eligibility ${String(eligibilityKind)} is incompatible with subject kind ${String(resource.subjectKind)}; expected ${expectedEligibility}`,
    )
  if (
    eligibilityKind === 'current-managed-member-character' &&
    section?.kind !== 'sensitive-evidence'
  )
    issues.push(
      `resource ${identity} managed-member eligibility requires a sensitive-evidence section`,
    )
  if (
    resource.subjectKind === 'character' &&
    section?.kind === 'sensitive-evidence' &&
    eligibilityKind !== 'current-managed-member-character'
  )
    issues.push(
      `resource ${identity} in a sensitive-evidence section must use current-managed-member-character eligibility`,
    )
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
  resource: PlatformResourceContribution,
  identity: string,
  esiOperationIds: ReadonlyMap<string, string>,
  issues: string[],
) {
  for (const operationId of resource.dependentOperationIds ?? [])
    if (!esiOperationIds.has(normalizeIdentity(operationId)))
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

function validatePages(
  manifest: PlatformModuleManifest,
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  issues: string[],
) {
  for (const page of manifest.nuxt.pages) {
    const identity = `${manifest.id}/${page.id}`
    validateContributionId(page.id, manifest.id, 'page', issues)
    validateContributionSection(manifest, sections, page, `page ${identity}`, issues)
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
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  navigationIds: Map<string, string>,
  issues: string[],
) {
  for (const navigation of manifest.nuxt.navigation) {
    const identity = `${manifest.id}/${navigation.id}`
    validateContributionId(navigation.id, manifest.id, 'navigation', issues)
    validateContributionSection(manifest, sections, navigation, `navigation ${identity}`, issues)
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
  const identifierIssues = platformModuleIdIssues(manifest.id)
  if (identifierIssues.includes('syntax'))
    issues.push(`module ID ${manifest.id} must be lowercase kebab-case`)
  if (identifierIssues.includes('too-long'))
    issues.push(`module ID ${manifest.id} must be at most 44 characters`)
  if (reservedModuleIds.has(manifest.id.toLowerCase()))
    issues.push(`module ID ${manifest.id} is reserved`)
  if (typeof manifest.defaultEnabled !== 'boolean')
    issues.push(`module ${manifest.id} must declare a boolean defaultEnabled value`)
}

function validateSections(manifest: PlatformModuleManifest, issues: string[]) {
  const sections = new Map<string, PlatformModuleSectionContribution>()
  if (manifest.sections === undefined) return sections
  if (!Array.isArray(manifest.sections) || manifest.sections.length === 0) {
    issues.push(`module ${manifest.id} sections must be a non-empty array when declared`)
    return sections
  }
  for (const section of manifest.sections) validateSection(manifest.id, section, sections, issues)
  return sections
}

function validateSection(
  moduleId: string,
  section: PlatformModuleSectionContribution | null | undefined,
  sections: Map<string, PlatformModuleSectionContribution>,
  issues: string[],
) {
  const identity = `${moduleId}/${String(section?.id)}`
  if (!section || typeof section.id !== 'string') {
    issues.push(`module ${moduleId} contains an invalid section declaration`)
    return
  }
  validateContributionId(section.id, moduleId, 'section', issues)
  const normalizedId = normalizeIdentity(section.id)
  if (sections.has(normalizedId))
    issues.push(`section ID ${section.id} is duplicated in ${moduleId}`)
  else sections.set(normalizedId, section)
  validateMember(
    section.kind,
    platformModuleSectionKinds,
    `section ${identity} uses unsupported kind ${String(section.kind)}`,
    issues,
  )
  if (section.defaultEnabled !== false) issues.push(`section ${identity} must default disabled`)
  if (section.kind === 'sensitive-evidence') {
    if (!Number.isSafeInteger(section.disclosureRevision) || section.disclosureRevision < 1)
      issues.push(`sensitive section ${identity} must declare a positive disclosure revision`)
  } else if (section.disclosureRevision !== undefined)
    issues.push(`non-evidence section ${identity} cannot declare a disclosure revision`)
}

function validateContributionSection(
  manifest: PlatformModuleManifest,
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  contribution: { readonly sectionId?: unknown },
  identity: string,
  issues: string[],
) {
  if (manifest.sections === undefined) {
    if (contribution.sectionId !== undefined)
      issues.push(`${identity} cannot declare a section when module ${manifest.id} has none`)
    return undefined
  }
  if (typeof contribution.sectionId !== 'string') {
    issues.push(`${identity} must declare exactly one section`)
    return undefined
  }
  const section = sections.get(normalizeIdentity(contribution.sectionId))
  if (!section) issues.push(`${identity} references unknown section ${contribution.sectionId}`)
  return section
}

function validateClassification(
  value: unknown,
  allowed: readonly string[],
  message: string,
  optional: boolean,
  issues: string[],
) {
  if (optional && value === undefined) return
  if (typeof value !== 'string' || !allowed.includes(value)) issues.push(message)
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
  if (!isPlatformContributionId(value))
    issues.push(`${kind} ${moduleId}/${value} must use a lowercase kebab-case ID`)
}

function validateExportName(value: string, moduleId: string, kind: string, issues: string[]) {
  if (!isPlatformExportName(value))
    issues.push(`${kind} ${moduleId} export ${value} is not a valid JavaScript export name`)
}

function validateOrganizationAuthorization(
  contribution: {
    readonly audience: unknown
    readonly requiredPermission: unknown
    readonly additionalRequiredPermissions?: unknown
  },
  identity: string,
  issues: string[],
) {
  if (!platformOrganizationAudiences.includes(contribution.audience as never))
    issues.push(
      `${identity} uses unsupported organization audience ${String(contribution.audience)}`,
    )
  if (!isValidPermissionKey(contribution.requiredPermission))
    issues.push(`${identity} must declare a valid required permission`)
  if (contribution.additionalRequiredPermissions !== undefined) {
    if (
      !Array.isArray(contribution.additionalRequiredPermissions) ||
      contribution.additionalRequiredPermissions.length === 0 ||
      !contribution.additionalRequiredPermissions.every(isValidPermissionKey)
    )
      issues.push(`${identity} must declare valid additional required permissions`)
    else if (
      new Set([contribution.requiredPermission, ...contribution.additionalRequiredPermissions])
        .size !==
      contribution.additionalRequiredPermissions.length + 1
    )
      issues.push(`${identity} must not declare duplicate required permissions`)
  }
}

function isValidPermissionKey(value: unknown): value is string {
  return typeof value === 'string' && isPlatformPermissionKey(value)
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
