import { CORE_DATA_PRODUCT_IDS } from '@eve-space/core-data-contract'
import type { PlatformActivityProviderContribution } from './activity.js'
import type {
  PlatformModuleManifest,
  PlatformReviewerContribution,
  PlatformRouteContribution,
} from './manifest.js'
import {
  platformPermissionSensitivities,
  type PlatformPermissionDeclaration,
  type PlatformPermissionProfileDeclaration,
} from './permissions.js'
import type {
  PlatformNavigationContribution,
  PlatformNuxtExposedContributions,
  PlatformPageContribution,
} from './nuxt.js'
import { platformIconTokens } from './nuxt.js'
import {
  platformPersistenceOperationModes,
  type PlatformPersistenceContributionReferences,
  type PlatformPersistenceOperationContribution,
  type PlatformPersistenceOperationReference,
  type PlatformResourcePersistenceReferences,
} from './persistence.js'
import {
  platformResourceBatchModes,
  platformSubjectKinds,
  type PlatformResourceBatchContribution,
  type PlatformResourceContribution,
} from './resources.js'
import {
  platformAuthorizationStrategies,
  platformModuleSectionKinds,
  platformOrganizationAudiences,
  platformOrganizationCommandIds,
  platformRouteExposures,
  platformRouteTargets,
  platformReviewerTargetKinds,
  type PlatformModuleSectionContribution,
} from './server.js'
import {
  compareStable,
  PlatformModuleValidationError,
  validatePlatformModuleCandidates,
  type PlatformModuleValidationAuthorities,
} from './validation.js'

const compiledPlatformModulesBrand: unique symbol = Symbol('compiled-platform-modules')

export interface PlatformModuleCandidate {
  readonly expectedModuleId: string
  readonly expectedPublisherPackage?: string
  readonly declaration: unknown
}

export interface PlatformModulePolicyContext {
  readonly manifests: readonly PlatformModuleManifest[]
}

export interface PlatformModulePolicy {
  readonly moduleId: string
  evaluate(
    manifest: PlatformModuleManifest,
    context: PlatformModulePolicyContext,
  ): readonly string[]
}

export interface PlatformModuleCompilationAuthorities extends PlatformModuleValidationAuthorities {
  readonly policies: readonly PlatformModulePolicy[]
}

export interface CompiledPlatformModules {
  readonly modules: readonly PlatformModuleManifest[]
  readonly [compiledPlatformModulesBrand]: true
}

export class PlatformModuleCompilationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    const sortedIssues = issues.toSorted(compareStable)
    const issueList = sortedIssues.map((issue) => `- ${issue}`).join('\n')
    super(`Invalid platform module declarations:\n${issueList}`)
    this.name = 'PlatformModuleCompilationError'
    this.issues = sortedIssues
  }
}

export function compilePlatformModules(
  candidates: readonly PlatformModuleCandidate[],
  authorities: PlatformModuleCompilationAuthorities,
): CompiledPlatformModules {
  const issues: string[] = []
  const parsedCandidates = candidates
    .toSorted((left, right) => compareStable(left.expectedModuleId, right.expectedModuleId))
    .flatMap((candidate) => {
      const manifest = parseManifest(candidate.declaration, candidate.expectedModuleId, issues)
      if (!manifest) return []
      if (manifest.id !== candidate.expectedModuleId)
        issues.push(
          `installed module ${candidate.expectedModuleId} descriptor declares mismatched ID ${manifest.id}`,
        )
      if (
        candidate.expectedPublisherPackage !== undefined &&
        manifest.release.publisherPackage !== candidate.expectedPublisherPackage
      )
        issues.push(
          `installed module ${candidate.expectedModuleId} descriptor declares mismatched publisher package ${manifest.release.publisherPackage}; expected ${candidate.expectedPublisherPackage}`,
        )
      return [
        { expectedModuleId: candidate.expectedModuleId, manifest: normalizeManifest(manifest) },
      ]
    })
  let validatedCandidates = parsedCandidates
  try {
    validatedCandidates = [...validatePlatformModuleCandidates(parsedCandidates, authorities)]
  } catch (error) {
    if (!(error instanceof PlatformModuleValidationError)) throw error
    issues.push(...error.issues)
  }

  const validated = validatedCandidates.map(({ manifest }) => manifest)
  const policyContext = { manifests: validated } satisfies PlatformModulePolicyContext
  const policies = authorities.policies.toSorted((left, right) =>
    compareStable(left.moduleId, right.moduleId),
  )
  for (const { expectedModuleId, manifest } of validatedCandidates)
    for (const policy of policies)
      if (policy.moduleId === expectedModuleId)
        issues.push(...policy.evaluate(manifest, policyContext))

  if (issues.length > 0) throw new PlatformModuleCompilationError(issues)

  const compiled = {
    modules: validated,
    [compiledPlatformModulesBrand]: true,
  } satisfies CompiledPlatformModules
  deepFreeze(compiled)
  return compiled
}

export function readCompiledPlatformModules(
  compiled: CompiledPlatformModules,
): readonly PlatformModuleManifest[] {
  if (compiled[compiledPlatformModulesBrand] !== true)
    throw new TypeError('Registry generation requires compiled platform modules')
  return compiled.modules
}

function normalizeManifest(manifest: PlatformModuleManifest): PlatformModuleManifest {
  return {
    ...manifest,
    permissions: manifest.permissions
      ?.map((permission) => ({
        ...permission,
        audiences: permission.audiences.toSorted(compareStable),
      }))
      .toSorted((left, right) => compareStable(left.key, right.key)),
    permissionProfiles: manifest.permissionProfiles
      ?.map((profile) => ({
        ...profile,
        audiences: profile.audiences.toSorted(compareStable),
        permissions: profile.permissions.toSorted(compareStable),
      }))
      .toSorted((left, right) => compareStable(left.id, right.id)),
    reviewerContributions: manifest.reviewerContributions?.toSorted(
      (left, right) => left.order - right.order || compareStable(left.id, right.id),
    ),
  }
}

function parseManifest(
  value: unknown,
  expectedModuleId: string,
  issues: string[],
): PlatformModuleManifest | undefined {
  const path = `installed module ${expectedModuleId}`
  const record = readRecord(
    value,
    `${path} declaration`,
    [
      'id',
      'release',
      'icon',
      'defaultEnabled',
      'permissions',
      'permissionProfiles',
      'reviewerContributions',
      'sections',
      'server',
      'nuxt',
    ],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path} id`, issues)
  const icon = readDeclaredMember(record.icon, platformIconTokens, `${path} icon`, issues)
  const defaultEnabled = readBoolean(record.defaultEnabled, `${path} defaultEnabled`, issues)
  const release = parseRelease(record.release, `${path} release`, issues)
  const server = readRecord(
    record.server,
    `${path} server`,
    [
      'package',
      'routes',
      'migrations',
      'persistenceOperations',
      'resources',
      'esiOperations',
      'activityProviders',
    ],
    issues,
  )
  const nuxt = readRecord(
    record.nuxt,
    `${path} nuxt`,
    ['package', 'pages', 'navigation', 'exposed'],
    issues,
  )
  if (
    id === undefined ||
    release === undefined ||
    icon === undefined ||
    defaultEnabled === undefined ||
    !server ||
    !nuxt
  )
    return undefined

  const permissions = readOptionalArray(
    record.permissions,
    `${path} permissions`,
    issues,
    parsePermission,
  )
  const permissionProfiles = readOptionalArray(
    record.permissionProfiles,
    `${path} permissionProfiles`,
    issues,
    parsePermissionProfile,
  )
  const reviewerContributions = readOptionalArray(
    record.reviewerContributions,
    `${path} reviewerContributions`,
    issues,
    parseReviewerContribution,
  )
  const sections = readOptionalArray(record.sections, `${path} sections`, issues, parseSection)
  const serverPackage = readString(server.package, `${path} server.package`, issues)
  const routes = readArray(server.routes, `${path} server.routes`, issues, parseRoute)
  const migrations = readArray(
    server.migrations,
    `${path} server.migrations`,
    issues,
    parseMigration,
  )
  const persistenceOperations = readArray(
    server.persistenceOperations,
    `${path} server.persistenceOperations`,
    issues,
    parsePersistenceOperation,
  )
  const resources = readArray(server.resources, `${path} server.resources`, issues, parseResource)
  const esiOperations = readArray(
    server.esiOperations,
    `${path} server.esiOperations`,
    issues,
    parseEsiOperation,
  )
  const activityProviders = readArray(
    server.activityProviders,
    `${path} server.activityProviders`,
    issues,
    parseActivityProvider,
  )
  const nuxtPackage = readString(nuxt.package, `${path} nuxt.package`, issues)
  const pages = readArray(nuxt.pages, `${path} nuxt.pages`, issues, parsePage)
  const navigation = readArray(nuxt.navigation, `${path} nuxt.navigation`, issues, parseNavigation)
  const exposed = parseExposed(nuxt.exposed, `${path} nuxt.exposed`, issues)
  if (
    serverPackage === undefined ||
    routes === undefined ||
    migrations === undefined ||
    persistenceOperations === undefined ||
    resources === undefined ||
    esiOperations === undefined ||
    activityProviders === undefined ||
    nuxtPackage === undefined ||
    pages === undefined ||
    navigation === undefined
  )
    return undefined

  return {
    id,
    release,
    icon,
    defaultEnabled,
    permissions,
    permissionProfiles,
    reviewerContributions,
    sections,
    server: {
      package: serverPackage,
      routes,
      migrations,
      persistenceOperations,
      resources,
      esiOperations,
      activityProviders,
    },
    nuxt: { package: nuxtPackage, pages, navigation, exposed },
  }
}

function parseRelease(
  value: unknown,
  path: string,
  issues: string[],
): PlatformModuleManifest['release'] | undefined {
  const record = readRecord(
    value,
    path,
    ['publisherPackage', 'version', 'hostContractRange'],
    issues,
  )
  if (!record) return undefined
  const publisherPackage = readString(record.publisherPackage, `${path}.publisherPackage`, issues)
  const version = readString(record.version, `${path}.version`, issues)
  const hostContractRange = readString(
    record.hostContractRange,
    `${path}.hostContractRange`,
    issues,
  )
  if (publisherPackage === undefined || version === undefined || hostContractRange === undefined)
    return undefined
  return { publisherPackage, version, hostContractRange }
}

function parsePermission(
  value: unknown,
  path: string,
  issues: string[],
): PlatformPermissionDeclaration | undefined {
  const record = readRecord(
    value,
    path,
    ['key', 'label', 'purpose', 'audiences', 'sensitivity', 'reviewAllowed'],
    issues,
  )
  if (!record) return undefined
  const key = readString(record.key, `${path}.key`, issues)
  const label = readString(record.label, `${path}.label`, issues)
  const purpose = readString(record.purpose, `${path}.purpose`, issues)
  const audiences = readMembers(
    record.audiences,
    platformOrganizationAudiences,
    `${path}.audiences`,
    issues,
  )
  const sensitivity = readDeclaredMember(
    record.sensitivity,
    platformPermissionSensitivities,
    `${path}.sensitivity`,
    issues,
  )
  const reviewAllowed = readBoolean(record.reviewAllowed, `${path}.reviewAllowed`, issues)
  if (
    key === undefined ||
    label === undefined ||
    purpose === undefined ||
    audiences === undefined ||
    sensitivity === undefined ||
    reviewAllowed === undefined
  )
    return undefined
  return { key, label, purpose, audiences, sensitivity, reviewAllowed }
}

function parsePermissionProfile(
  value: unknown,
  path: string,
  issues: string[],
): PlatformPermissionProfileDeclaration | undefined {
  const record = readRecord(
    value,
    path,
    ['id', 'label', 'description', 'audiences', 'permissions'],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const label = readString(record.label, `${path}.label`, issues)
  const description = readString(record.description, `${path}.description`, issues)
  const audiences = readMembers(
    record.audiences,
    platformOrganizationAudiences,
    `${path}.audiences`,
    issues,
  )
  const permissions = readStringArray(record.permissions, `${path}.permissions`, issues)
  if (
    id === undefined ||
    label === undefined ||
    description === undefined ||
    audiences === undefined ||
    permissions === undefined
  )
    return undefined
  return { id, label, description, audiences, permissions }
}

function parseReviewerContribution(
  value: unknown,
  path: string,
  issues: string[],
): PlatformReviewerContribution | undefined {
  const record = readRecord(
    value,
    path,
    [
      'id',
      'routeId',
      'audience',
      'requiredPermission',
      'target',
      'panelExport',
      'label',
      'description',
      'icon',
      'order',
    ],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const routeId = readString(record.routeId, `${path}.routeId`, issues)
  const audience = readDeclaredMember(
    record.audience,
    platformOrganizationAudiences,
    `${path}.audience`,
    issues,
  )
  const requiredPermission = readString(
    record.requiredPermission,
    `${path}.requiredPermission`,
    issues,
  )
  const target = readDeclaredMember(
    record.target,
    platformReviewerTargetKinds,
    `${path}.target`,
    issues,
  )
  const panelExport = readString(record.panelExport, `${path}.panelExport`, issues)
  const label = readString(record.label, `${path}.label`, issues)
  const description = readString(record.description, `${path}.description`, issues)
  const icon = readDeclaredMember(record.icon, platformIconTokens, `${path}.icon`, issues)
  const order = readNumber(record.order, `${path}.order`, issues)
  if (
    id === undefined ||
    routeId === undefined ||
    audience === undefined ||
    requiredPermission === undefined ||
    target === undefined ||
    panelExport === undefined ||
    label === undefined ||
    description === undefined ||
    icon === undefined ||
    order === undefined
  )
    return undefined
  return {
    id,
    routeId,
    audience,
    requiredPermission,
    target,
    panelExport,
    label,
    description,
    icon,
    order,
  }
}

function parseSection(
  value: unknown,
  path: string,
  issues: string[],
): PlatformModuleSectionContribution | undefined {
  const record = readRecord(
    value,
    path,
    ['id', 'kind', 'defaultEnabled', 'disclosureRevision'],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const kind = readDeclaredMember(record.kind, platformModuleSectionKinds, `${path}.kind`, issues)
  if (record.defaultEnabled !== false) issues.push(`${path}.defaultEnabled must be false`)
  if (id === undefined || kind === undefined || record.defaultEnabled !== false) return undefined
  if (kind === 'sensitive-evidence') {
    const disclosureRevision = readNumber(
      record.disclosureRevision,
      `${path}.disclosureRevision`,
      issues,
    )
    if (disclosureRevision === undefined) return undefined
    return { id, kind, defaultEnabled: false, disclosureRevision }
  }
  if (record.disclosureRevision !== undefined)
    issues.push(`${path}.disclosureRevision is not allowed for ${kind}`)
  return { id, kind, defaultEnabled: false }
}

function parseRoute(
  value: unknown,
  path: string,
  issues: string[],
): PlatformRouteContribution | undefined {
  const record = readRecord(
    value,
    path,
    [
      'id',
      'namespace',
      'exportName',
      'authorization',
      'audience',
      'requiredPermission',
      'additionalRequiredPermissions',
      'coreDataProducts',
      'persistenceOperations',
      'sectionId',
      'target',
      'exposure',
      'reviewerEvidenceResourceId',
      'organizationCommands',
    ],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const namespace = readString(record.namespace, `${path}.namespace`, issues)
  const exportName = readString(record.exportName, `${path}.exportName`, issues)
  const authorization = readDeclaredMember(
    record.authorization,
    platformAuthorizationStrategies,
    `${path}.authorization`,
    issues,
  )
  const audience = readDeclaredMember(
    record.audience,
    platformOrganizationAudiences,
    `${path}.audience`,
    issues,
  )
  const requiredPermission =
    readString(record.requiredPermission, `${path}.requiredPermission`, issues) ?? ''
  const additionalRequiredPermissions = readOptionalStringArray(
    record.additionalRequiredPermissions,
    `${path}.additionalRequiredPermissions`,
    issues,
  )
  const coreDataProducts = readOptionalMembers(
    record.coreDataProducts,
    CORE_DATA_PRODUCT_IDS,
    `${path} core-data products`,
    issues,
  )
  const persistence = parsePersistenceReferences(record, path, issues)
  const sectionId = readOptionalString(record.sectionId, `${path}.sectionId`, issues)
  const target = readOptionalMember(record.target, platformRouteTargets, `${path}.target`, issues)
  const exposure = readOptionalMember(
    record.exposure,
    platformRouteExposures,
    `${path}.exposure`,
    issues,
  )
  const reviewerEvidenceResourceId = readOptionalString(
    record.reviewerEvidenceResourceId,
    `${path}.reviewerEvidenceResourceId`,
    issues,
  )
  const organizationCommands = readOptionalMembers(
    record.organizationCommands,
    platformOrganizationCommandIds,
    `${path}.organizationCommands`,
    issues,
  )
  if (
    id === undefined ||
    namespace === undefined ||
    exportName === undefined ||
    authorization === undefined ||
    audience === undefined ||
    persistence === undefined
  )
    return undefined
  return {
    id,
    namespace,
    exportName,
    authorization,
    audience,
    requiredPermission,
    additionalRequiredPermissions,
    coreDataProducts,
    persistenceOperations: persistence.persistenceOperations,
    sectionId,
    target,
    exposure,
    reviewerEvidenceResourceId,
    organizationCommands,
  }
}

function parseMigration(value: unknown, path: string, issues: string[]) {
  const record = readRecord(value, path, ['name'], issues)
  if (!record) return undefined
  const name = readString(record.name, `${path}.name`, issues)
  return name === undefined ? undefined : { name }
}

function parsePersistenceOperation(
  value: unknown,
  path: string,
  issues: string[],
): PlatformPersistenceOperationContribution | undefined {
  const record = readRecord(
    value,
    path,
    ['id', 'method', 'revision', 'mode', 'exportName', 'migration'],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const method = readString(record.method, `${path}.method`, issues)
  const revision = readNumber(record.revision, `${path}.revision`, issues)
  const mode = readDeclaredMember(
    record.mode,
    platformPersistenceOperationModes,
    `${path}.mode`,
    issues,
  )
  const exportName = readString(record.exportName, `${path}.exportName`, issues)
  const migration = readString(record.migration, `${path}.migration`, issues)
  if (
    id === undefined ||
    method === undefined ||
    revision === undefined ||
    mode === undefined ||
    exportName === undefined ||
    migration === undefined
  )
    return undefined
  return { id, method, revision, mode, exportName, migration }
}

function parseResource(
  value: unknown,
  path: string,
  issues: string[],
): PlatformResourceContribution | undefined {
  const record = readRecord(
    value,
    path,
    [
      'id',
      'operationId',
      'materializationIntervalSeconds',
      'exportName',
      'subjectKind',
      'eligibility',
      'coreDataProducts',
      'dependentOperationIds',
      'persistence',
      'batch',
      'sectionId',
      'scheduled',
    ],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const operationId = readString(record.operationId, `${path}.operationId`, issues)
  const materializationIntervalSeconds = readNumber(
    record.materializationIntervalSeconds,
    `${path}.materializationIntervalSeconds`,
    issues,
  )
  const exportName = readString(record.exportName, `${path}.exportName`, issues)
  const subjectKind = readDeclaredMember(
    record.subjectKind,
    platformSubjectKinds,
    `${path}.subjectKind`,
    issues,
  )
  const eligibility = readRecord(record.eligibility, `${path}.eligibility`, ['kind'], issues)
  const eligibilityKind = eligibility
    ? readString(eligibility.kind, `${path}.eligibility.kind`, issues)
    : undefined
  const coreDataProducts = readOptionalMembers(
    record.coreDataProducts,
    CORE_DATA_PRODUCT_IDS,
    `${path} core-data products`,
    issues,
  )
  const dependentOperationIds = readOptionalStringArray(
    record.dependentOperationIds,
    `${path}.dependentOperationIds`,
    issues,
  )
  const persistence = parseResourcePersistence(record.persistence, `${path}.persistence`, issues)
  const batch = parseOptionalBatch(record.batch, `${path}.batch`, issues)
  const sectionId = readOptionalString(record.sectionId, `${path}.sectionId`, issues)
  const scheduled =
    record.scheduled === undefined
      ? undefined
      : readBoolean(record.scheduled, `${path}.scheduled`, issues)
  if (
    id === undefined ||
    operationId === undefined ||
    materializationIntervalSeconds === undefined ||
    exportName === undefined ||
    subjectKind === undefined ||
    eligibilityKind === undefined ||
    persistence === undefined
  )
    return undefined
  const base = {
    id,
    operationId,
    materializationIntervalSeconds,
    exportName,
    coreDataProducts,
    dependentOperationIds,
    persistence,
    scheduled,
  }
  return {
    ...base,
    subjectKind,
    eligibility: { kind: eligibilityKind },
    batch,
    sectionId,
  } as PlatformResourceContribution
}

function parseResourcePersistence(
  value: unknown,
  path: string,
  issues: string[],
): PlatformResourcePersistenceReferences | undefined {
  const record = readRecord(value, path, ['projection', 'materialization'], issues)
  if (!record) return undefined
  const projection = readArray(
    record.projection,
    `${path}.projection`,
    issues,
    parsePersistenceReference,
  )
  const materialization = readArray(
    record.materialization,
    `${path}.materialization`,
    issues,
    parsePersistenceReference,
  )
  return projection && materialization ? { projection, materialization } : undefined
}

function parseOptionalBatch(
  value: unknown,
  path: string,
  issues: string[],
): PlatformResourceBatchContribution | undefined {
  if (value === undefined) return undefined
  const record = readRecord(value, path, ['mode', 'operationId'], issues)
  if (!record) return undefined
  const mode = readDeclaredMember(record.mode, platformResourceBatchModes, `${path}.mode`, issues)
  const operationId = readString(record.operationId, `${path}.operationId`, issues)
  return mode === undefined || operationId === undefined ? undefined : { mode, operationId }
}

function parseEsiOperation(value: unknown, path: string, issues: string[]) {
  const record = readRecord(value, path, ['id', 'exportName'], issues)
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const exportName = readString(record.exportName, `${path}.exportName`, issues)
  return id === undefined || exportName === undefined ? undefined : { id, exportName }
}

function parseActivityProvider(
  value: unknown,
  path: string,
  issues: string[],
): PlatformActivityProviderContribution | undefined {
  const record = readRecord(
    value,
    path,
    [
      'id',
      'exportName',
      'audience',
      'requiredPermission',
      'additionalRequiredPermissions',
      'sectionId',
      'coreDataProducts',
      'persistenceOperations',
      'freshness',
    ],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const exportName = readString(record.exportName, `${path}.exportName`, issues)
  const audience = readDeclaredMember(
    record.audience,
    platformOrganizationAudiences,
    `${path}.audience`,
    issues,
  )
  const requiredPermission =
    readString(record.requiredPermission, `${path}.requiredPermission`, issues) ?? ''
  const additionalRequiredPermissions = readOptionalStringArray(
    record.additionalRequiredPermissions,
    `${path}.additionalRequiredPermissions`,
    issues,
  )
  const sectionId = readOptionalString(record.sectionId, `${path}.sectionId`, issues)
  const coreDataProducts = readOptionalMembers(
    record.coreDataProducts,
    CORE_DATA_PRODUCT_IDS,
    `${path} core-data products`,
    issues,
  )
  const persistence = parsePersistenceReferences(record, path, issues)
  const freshness = readRecord(record.freshness, `${path}.freshness`, ['staleAfterSeconds'], issues)
  const staleAfterSeconds = freshness
    ? readNumber(freshness.staleAfterSeconds, `${path}.freshness.staleAfterSeconds`, issues)
    : undefined
  if (
    id === undefined ||
    exportName === undefined ||
    audience === undefined ||
    persistence === undefined ||
    staleAfterSeconds === undefined
  )
    return undefined
  return {
    id,
    exportName,
    audience,
    requiredPermission,
    additionalRequiredPermissions,
    sectionId,
    coreDataProducts,
    persistenceOperations: persistence.persistenceOperations,
    freshness: { staleAfterSeconds },
  }
}

function parsePage(
  value: unknown,
  path: string,
  issues: string[],
): PlatformPageContribution | undefined {
  const record = readRecord(
    value,
    path,
    ['id', 'name', 'path', 'file', 'extensionPoint', 'audience', 'sectionId'],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const name = readString(record.name, `${path}.name`, issues)
  const pagePath = readString(record.path, `${path}.path`, issues)
  const file = readString(record.file, `${path}.file`, issues)
  const extensionPoint = readDeclaredMember(
    record.extensionPoint,
    ['root', 'character-shell'] as const,
    `${path}.extensionPoint`,
    issues,
  )
  const audience = readDeclaredMember(
    record.audience,
    ['public', 'authenticated', 'admin', 'owned-character'] as const,
    `${path}.audience`,
    issues,
  )
  const sectionId = readOptionalString(record.sectionId, `${path}.sectionId`, issues)
  if (
    id === undefined ||
    name === undefined ||
    pagePath === undefined ||
    file === undefined ||
    extensionPoint === undefined ||
    audience === undefined
  )
    return undefined
  return { id, name, path: pagePath, file, extensionPoint, audience, sectionId }
}

function parseNavigation(
  value: unknown,
  path: string,
  issues: string[],
): PlatformNavigationContribution | undefined {
  const record = readRecord(
    value,
    path,
    [
      'id',
      'label',
      'description',
      'to',
      'icon',
      'audience',
      'placement',
      'order',
      'pageName',
      'sectionId',
    ],
    issues,
  )
  if (!record) return undefined
  const id = readString(record.id, `${path}.id`, issues)
  const label = readString(record.label, `${path}.label`, issues)
  const description = readString(record.description, `${path}.description`, issues)
  const to = readString(record.to, `${path}.to`, issues)
  const icon = readOptionalMember(record.icon, platformIconTokens, `${path}.icon`, issues)
  const audience = readDeclaredMember(
    record.audience,
    ['public', 'authenticated', 'admin', 'owned-character'] as const,
    `${path}.audience`,
    issues,
  )
  const placement = readDeclaredMember(
    record.placement,
    ['dashboard', 'character'] as const,
    `${path}.placement`,
    issues,
  )
  const order = readNumber(record.order, `${path}.order`, issues)
  const pageName = readString(record.pageName, `${path}.pageName`, issues)
  const sectionId = readOptionalString(record.sectionId, `${path}.sectionId`, issues)
  if (
    id === undefined ||
    label === undefined ||
    description === undefined ||
    to === undefined ||
    audience === undefined ||
    placement === undefined ||
    order === undefined ||
    pageName === undefined
  )
    return undefined
  return { id, label, description, to, icon, audience, placement, order, pageName, sectionId }
}

function parseExposed(
  value: unknown,
  path: string,
  issues: string[],
): PlatformNuxtExposedContributions | undefined {
  if (value === undefined) return undefined
  const record = readRecord(
    value,
    path,
    ['components', 'composables', 'hooks', 'configurationKeys', 'virtualFiles'],
    issues,
  )
  if (!record) return undefined
  return {
    components: readOptionalStringArray(record.components, `${path}.components`, issues),
    composables: readOptionalStringArray(record.composables, `${path}.composables`, issues),
    hooks: readOptionalStringArray(record.hooks, `${path}.hooks`, issues),
    configurationKeys: readOptionalStringArray(
      record.configurationKeys,
      `${path}.configurationKeys`,
      issues,
    ),
    virtualFiles: readOptionalStringArray(record.virtualFiles, `${path}.virtualFiles`, issues),
  }
}

function parsePersistenceReferences(
  record: Record<string, unknown>,
  path: string,
  issues: string[],
): PlatformPersistenceContributionReferences | undefined {
  const persistenceOperations = readArray(
    record.persistenceOperations,
    `${path}.persistenceOperations`,
    issues,
    parsePersistenceReference,
  )
  return { persistenceOperations: persistenceOperations ?? [] }
}

function parsePersistenceReference(
  value: unknown,
  path: string,
  issues: string[],
): PlatformPersistenceOperationReference | undefined {
  const record = readRecord(value, path, ['operationId'], issues)
  if (!record) return undefined
  const operationId = readString(record.operationId, `${path}.operationId`, issues)
  return operationId === undefined ? undefined : { operationId }
}

function readRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  issues: string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return undefined
  }
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(value))
    if (!allowed.has(key)) issues.push(`${path}.${key} is not allowed`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, path: string, issues: string[]) {
  if (typeof value === 'string') return value
  issues.push(`${path} must be a string`)
  return undefined
}

function readOptionalString(value: unknown, path: string, issues: string[]) {
  return value === undefined ? undefined : readString(value, path, issues)
}

function readBoolean(value: unknown, path: string, issues: string[]) {
  if (typeof value === 'boolean') return value
  issues.push(`${path} must be a boolean`)
  return undefined
}

function readNumber(value: unknown, path: string, issues: string[]) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  issues.push(`${path} must be a finite number`)
  return undefined
}

function readArray<Value>(
  value: unknown,
  path: string,
  issues: string[],
  parse: (value: unknown, path: string, issues: string[]) => Value | undefined,
): readonly Value[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`)
    return undefined
  }
  const parsed: Value[] = []
  for (const [index, item] of value.entries()) {
    const result = parse(item, `${path}[${index}]`, issues)
    if (result !== undefined) parsed.push(result)
  }
  return parsed.length === value.length ? parsed : undefined
}

function readOptionalArray<Value>(
  value: unknown,
  path: string,
  issues: string[],
  parse: (value: unknown, path: string, issues: string[]) => Value | undefined,
) {
  return value === undefined ? undefined : readArray(value, path, issues, parse)
}

function readOptionalStringArray(value: unknown, path: string, issues: string[]) {
  return value === undefined
    ? undefined
    : readArray(value, path, issues, (item, itemPath, itemIssues) =>
        readString(item, itemPath, itemIssues),
      )
}

function readStringArray(value: unknown, path: string, issues: string[]) {
  return readArray(value, path, issues, (item, itemPath, itemIssues) =>
    readString(item, itemPath, itemIssues),
  )
}

function readDeclaredMember<const Member extends string>(
  value: unknown,
  _allowed: readonly Member[],
  path: string,
  issues: string[],
): Member | undefined {
  if (typeof value === 'string') return value as Member
  issues.push(`${path} must be a string`)
  return '' as Member
}

function readOptionalMember<const Member extends string>(
  value: unknown,
  allowed: readonly Member[],
  path: string,
  issues: string[],
) {
  return value === undefined ? undefined : readDeclaredMember(value, allowed, path, issues)
}

function readOptionalMembers<const Member extends string>(
  value: unknown,
  allowed: readonly Member[],
  path: string,
  issues: string[],
): readonly Member[] | undefined {
  return value === undefined
    ? undefined
    : readArray(value, path, issues, (item, itemPath, itemIssues) =>
        readDeclaredMember(item, allowed, itemPath, itemIssues),
      )
}

function readMembers<const Member extends string>(
  value: unknown,
  allowed: readonly Member[],
  path: string,
  issues: string[],
) {
  return readArray(value, path, issues, (item, itemPath, itemIssues) =>
    readDeclaredMember(item, allowed, itemPath, itemIssues),
  )
}

function deepFreeze(value: object): void {
  for (const property of Reflect.ownKeys(value)) {
    const child = Reflect.get(value, property)
    if (typeof child === 'object' && child !== null && !Object.isFrozen(child)) deepFreeze(child)
  }
  Object.freeze(value)
}
