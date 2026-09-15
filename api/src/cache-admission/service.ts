import { createHash } from 'node:crypto'
import {
  coreOrganizationAdmissionScopes,
  type PlatformInstalledOrganizationAdmissionScopeDescriptor,
} from '@eve-space/platform-module-contract'
import { installedModuleOrganizationAdmissionScopes } from '../generated/platform/installed-module-runtime.js'
import {
  resolveOrganizationEntitlementScope,
  type OrganizationSessionContext,
} from '../organization/access-policy.js'
import { getOrganizationGroupPermissions } from '../organization/group-permissions.js'
import { authorizeOrganizationContribution } from '../organization/module-authorization.js'
import { normalizeScopeSet } from '../scopes.js'
import {
  loadCharacterAdmissionFacts,
  loadOrganizationAdmissionFoundation,
  loadOrganizationRevisionFacts,
  type CharacterAdmissionFact,
  type OrganizationAdmissionFoundation,
  type OrganizationRevisionFacts,
} from './store.js'

const characterRevisionPrefix = 'character-admission:v1:sha256:'
const organizationRevisionPrefix = 'organization-admission:v1:sha256:'
export interface CacheAdmissionContext {
  readonly userId: string
  readonly characters: readonly {
    readonly characterId: number
    readonly admissionRevision: string | null
  }[]
  readonly organization: {
    readonly organizationVersion: number
    readonly admissionRevision: string
    readonly validUntil: string | null
    readonly admissionScopes: readonly string[]
  } | null
}

export interface CacheAdmissionServiceOptions {
  readonly now?: Date
  readonly loadCharacters?: (userId: string) => Promise<readonly CharacterAdmissionFact[]>
  readonly loadOrganization?: (userId: string) => Promise<OrganizationAdmissionFoundation | null>
  readonly loadOrganizationRevision?: (
    userId: string,
    organizationVersion: number,
    now: Date,
  ) => Promise<OrganizationRevisionFacts>
  readonly loadPermissions?: typeof getOrganizationGroupPermissions
  readonly authorize?: typeof authorizeOrganizationContribution
  readonly moduleAdmissionScopes?: readonly PlatformInstalledOrganizationAdmissionScopeDescriptor[]
}

export async function loadCacheAdmissionContext(
  userId: string,
  options: CacheAdmissionServiceOptions = {},
): Promise<CacheAdmissionContext> {
  const now = options.now ?? new Date()
  const [characterFacts, organizationFoundation] = await Promise.all([
    (options.loadCharacters ?? loadCharacterAdmissionFacts)(userId),
    (options.loadOrganization ?? loadOrganizationAdmissionFoundation)(userId),
  ])
  const characters = characterFacts
    .map((fact) => ({
      characterId: fact.characterId,
      admissionRevision: characterAdmissionRevision(fact),
    }))
    .toSorted((left, right) => left.characterId - right.characterId)
  const organization = await resolveOrganizationAdmission(
    userId,
    organizationFoundation,
    now,
    options,
  )
  return { userId, characters, organization }
}

async function resolveOrganizationAdmission(
  userId: string,
  foundation: OrganizationAdmissionFoundation | null,
  now: Date,
  options: CacheAdmissionServiceOptions,
) {
  if (
    !foundation ||
    foundation.context.blocked ||
    resolveOrganizationEntitlementScope(foundation.context, now) === 'none'
  )
    return null

  const enabledModuleIds = new Set(
    foundation.modules.filter(({ enabled }) => enabled).map(({ moduleId }) => moduleId),
  )
  const declarations = uniqueAdmissionScopes(
    (options.moduleAdmissionScopes ?? installedModuleOrganizationAdmissionScopes).filter(
      ({ moduleId }) => enabledModuleIds.has(moduleId),
    ),
  )
  const revisionFacts = await (options.loadOrganizationRevision ?? loadOrganizationRevisionFacts)(
    userId,
    foundation.context.organizationVersion,
    now,
  )
  const loadPermissions = options.loadPermissions ?? getOrganizationGroupPermissions
  const permissions = await loadPermissions(userId, now, foundation.context.organizationVersion)
  const authorize = options.authorize ?? authorizeOrganizationContribution
  const authorizationResults = await Promise.all(
    declarations.map(async (declaration) => ({
      declaration,
      authorization: await authorize(userId, foundation.context, declaration, now),
    })),
  )
  const moduleScopes = authorizationResults
    .filter(({ authorization }) => authorization.authorized)
    .map(({ declaration }) => declaration.admissionScope)
  const admissionScopes = [
    coreOrganizationAdmissionScopes.activities,
    ...(revisionFacts.roles.some(({ role }) => role === 'hr_auditor')
      ? [coreOrganizationAdmissionScopes.rosterCoverage]
      : []),
    ...moduleScopes,
  ].toSorted((left, right) => left.localeCompare(right))
  if (admissionScopes.length === 0) return null

  const validUntil = earliestAuthorizationDeadline(foundation.context, revisionFacts, now)
  const admissionRevision = createRevision(organizationRevisionPrefix, {
    organizationVersion: foundation.context.organizationVersion,
    registrationPolicyVersion: foundation.registrationPolicyVersion,
    latestAuditSequence: revisionFacts.latestAuditSequence,
    compliance: {
      state: foundation.context.state,
      evidenceFreshness: foundation.context.evidenceFreshness,
      reviewDeadline: foundation.context.reviewDeadline?.toISOString() ?? null,
      accessValidUntil: foundation.context.accessValidUntil?.toISOString() ?? null,
      blocked: foundation.context.blocked,
    },
    roles: revisionFacts.roles,
    groups: revisionFacts.groups,
    permissions: {
      modules: normalizeScopeSet(permissions.modules),
      services: normalizeScopeSet(permissions.services),
    },
    modules: foundation.modules.map(({ moduleId, enabled, updatedAt }) => ({
      moduleId,
      enabled,
      updatedAt: updatedAt?.toISOString() ?? null,
    })),
    admissionScopes,
  })
  return {
    organizationVersion: foundation.context.organizationVersion,
    admissionRevision,
    validUntil: validUntil?.toISOString() ?? null,
    admissionScopes,
  }
}

function characterAdmissionRevision(fact: CharacterAdmissionFact) {
  if (
    !fact.subjectLifecycleId ||
    fact.tokenCharacterId !== fact.characterId ||
    fact.tokenVersion === null ||
    !Number.isSafeInteger(fact.tokenVersion) ||
    fact.tokenVersion < 0 ||
    !Array.isArray(fact.scopes) ||
    !fact.scopes.every((scope) => typeof scope === 'string')
  )
    return null
  return createRevision(characterRevisionPrefix, {
    subjectLifecycleId: fact.subjectLifecycleId,
    tokenVersion: fact.tokenVersion,
    scopes: normalizeScopeSet(fact.scopes),
  })
}

function createRevision(prefix: string, value: unknown) {
  return `${prefix}${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

function uniqueAdmissionScopes(
  declarations: readonly PlatformInstalledOrganizationAdmissionScopeDescriptor[],
) {
  return [
    ...new Map(
      declarations.map((declaration) => [declaration.admissionScope, declaration]),
    ).values(),
  ].toSorted((left, right) => left.admissionScope.localeCompare(right.admissionScope))
}

function earliestAuthorizationDeadline(
  organization: OrganizationSessionContext,
  facts: OrganizationRevisionFacts,
  now: Date,
) {
  const deadlines = [
    organization.accessValidUntil,
    organization.state === 'review_required' ? organization.reviewDeadline : null,
    ...facts.roles.map(({ evidenceReviewDeadline }) =>
      evidenceReviewDeadline ? new Date(evidenceReviewDeadline) : null,
    ),
    ...facts.groups.map(({ expiresAt }) => (expiresAt ? new Date(expiresAt) : null)),
  ].filter((deadline): deadline is Date => deadline !== null && deadline > now)
  return deadlines.toSorted((left, right) => left.getTime() - right.getTime())[0] ?? null
}
