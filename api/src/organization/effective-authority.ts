import { and, eq, isNull } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAuthorityEvidence,
  organizationDerivedAuthoritySources,
  organizationRoleGrants,
  platformSubjectLifecycles,
  type OrganizationAuthorityEvidenceStatus,
} from '../db/schema.js'
import { hasCurrentComplianceAccess } from './compliance-access.js'
import {
  canUseAuthoritySource,
  evaluateDerivedDirectorSource,
  type AuthorityEvidenceState,
  type AuthorityOperation,
} from './authority-policy.js'
import { hasActiveOrganizationMemberBlock } from './member-block.js'

type Database = DatabaseTransaction | typeof db

interface SourceRow {
  sourceId: string
  characterId: number
  sourceSubjectLifecycleId: string
  authorizationGeneration: number
  authorityCorporationId: number
  observedAllianceId: number | null
  directorRolePresent: boolean
  status: OrganizationAuthorityEvidenceStatus
  freshUntil: Date
  graceUntil: Date | null
  invalidatedAt: Date | null
  currentUserId: string | null
  currentCorporationId: number | null
  currentAllianceId: number | null
  currentSubjectLifecycleId: string | null
  currentAuthorizationGeneration: number | null
  currentScopes: string[] | null
  requiredScope: string
}

interface OrganizationBoundary {
  readonly organizationType: 'corporation' | 'alliance'
  readonly organizationId: number
  readonly derivedDirectorAuthorityEnabled: boolean
}

const currentSourceSelection = {
  currentUserId: characters.userId,
  currentCorporationId: characters.corporationId,
  currentAllianceId: characters.allianceId,
  currentSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
  currentAuthorizationGeneration: eveTokens.tokenVersion,
  currentScopes: eveTokens.scopes,
}

interface EffectiveAuthoritySource {
  readonly sourceId: string
  readonly characterId: number
  readonly state: AuthorityEvidenceState
}

export interface EffectiveOrganizationAuthority {
  readonly organizationOwner: boolean
  readonly explicitDirector: boolean
  readonly derivedDirector: boolean
  readonly director: boolean
  readonly degraded: boolean
  readonly ownerSource: EffectiveAuthoritySource | null
  readonly derivedSources: readonly EffectiveAuthoritySource[]
}

export interface EffectiveAuthorityLoadOptions {
  readonly requireComplianceAccess?: boolean
}

export async function loadEffectiveOrganizationAuthority(
  database: Database,
  organizationVersion: number,
  userId: string,
  operation: AuthorityOperation,
  now = new Date(),
  options: EffectiveAuthorityLoadOptions = {},
): Promise<EffectiveOrganizationAuthority> {
  if (
    options.requireComplianceAccess !== false &&
    !(await hasCurrentComplianceAccess(database, organizationVersion, userId, now))
  )
    return noAuthority()

  const organization = await loadOrganization(database, organizationVersion)
  if (
    !organization ||
    (await hasActiveOrganizationMemberBlock(database, organizationVersion, userId))
  )
    return noAuthority()

  const owner = await loadOwnerSource(database, organizationVersion, userId)
  const ownerSource = owner ? evaluateSource(owner, userId, organization, true, now) : null
  const explicitDirector = await hasExplicitDirector(database, organizationVersion, userId)
  const derivedRows = organization.derivedDirectorAuthorityEnabled
    ? await loadDerivedSources(database, organizationVersion, userId)
    : []
  const derivedSources = derivedRows.map((source) =>
    evaluateSource(source, userId, organization, true, now),
  )
  const organizationOwner = ownerSource?.state
    ? canUseAuthoritySource(ownerSource.state, operation)
    : false
  const derivedDirector = derivedSources.some(({ state }) =>
    canUseAuthoritySource(state, operation),
  )

  return {
    organizationOwner,
    explicitDirector,
    derivedDirector,
    director: explicitDirector || derivedDirector,
    degraded:
      ownerSource?.state === 'degraded' || derivedSources.some(({ state }) => state === 'degraded'),
    ownerSource,
    derivedSources,
  }
}

async function loadOrganization(database: Database, organizationVersion: number) {
  const [organization] = await database
    .select({
      organizationType: deploymentSettings.organizationType,
      organizationId: deploymentSettings.organizationId,
      organizationVersion: deploymentSettings.organizationVersion,
      derivedDirectorAuthorityEnabled: deploymentSettings.derivedDirectorAuthorityEnabled,
    })
    .from(deploymentSettings)
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
  return organization ?? null
}

async function hasExplicitDirector(
  database: Database,
  organizationVersion: number,
  userId: string,
) {
  const [grant] = await database
    .select({ grantId: organizationRoleGrants.grantId })
    .from(organizationRoleGrants)
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organizationVersion),
        eq(organizationRoleGrants.userId, userId),
        eq(organizationRoleGrants.role, 'director'),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .limit(1)
  return Boolean(grant)
}

async function loadOwnerSource(
  database: Database,
  organizationVersion: number,
  userId: string,
): Promise<SourceRow | null> {
  const [source] = await database
    .select({
      sourceId: organizationAuthorityEvidence.evidenceId,
      characterId: organizationAuthorityEvidence.characterId,
      sourceSubjectLifecycleId: organizationAuthorityEvidence.sourceSubjectLifecycleId,
      authorizationGeneration: organizationAuthorityEvidence.authorizationGeneration,
      authorityCorporationId: organizationAuthorityEvidence.authorityCorporationId,
      observedAllianceId: organizationAuthorityEvidence.observedAllianceId,
      directorRolePresent: organizationAuthorityEvidence.directorRolePresent,
      status: organizationAuthorityEvidence.status,
      freshUntil: organizationAuthorityEvidence.freshUntil,
      graceUntil: organizationAuthorityEvidence.graceUntil,
      invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      requiredScope: organizationAuthorityEvidence.requiredScope,
      ...currentSourceSelection,
    })
    .from(organizationAuthorityEvidence)
    .innerJoin(
      organizationRoleGrants,
      eq(organizationRoleGrants.grantId, organizationAuthorityEvidence.grantId),
    )
    .leftJoin(characters, eq(characters.characterId, organizationAuthorityEvidence.characterId))
    .leftJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, organizationAuthorityEvidence.characterId),
    )
    .leftJoin(eveTokens, eq(eveTokens.characterId, organizationAuthorityEvidence.characterId))
    .where(
      and(
        eq(organizationAuthorityEvidence.deploymentId, 1),
        eq(organizationAuthorityEvidence.organizationVersion, organizationVersion),
        eq(organizationAuthorityEvidence.userId, userId),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .limit(1)
  return source ?? null
}

async function loadDerivedSources(
  database: Database,
  organizationVersion: number,
  userId: string,
): Promise<SourceRow[]> {
  return database
    .select({
      sourceId: organizationDerivedAuthoritySources.sourceId,
      characterId: organizationDerivedAuthoritySources.characterId,
      sourceSubjectLifecycleId: organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
      authorizationGeneration: organizationDerivedAuthoritySources.authorizationGeneration,
      authorityCorporationId: organizationDerivedAuthoritySources.authorityCorporationId,
      observedAllianceId: organizationDerivedAuthoritySources.observedAllianceId,
      directorRolePresent: organizationDerivedAuthoritySources.directorRolePresent,
      status: organizationDerivedAuthoritySources.status,
      freshUntil: organizationDerivedAuthoritySources.freshUntil,
      graceUntil: organizationDerivedAuthoritySources.graceUntil,
      invalidatedAt: organizationDerivedAuthoritySources.invalidatedAt,
      requiredScope: organizationDerivedAuthoritySources.requiredScope,
      ...currentSourceSelection,
    })
    .from(organizationDerivedAuthoritySources)
    .leftJoin(
      characters,
      eq(characters.characterId, organizationDerivedAuthoritySources.characterId),
    )
    .leftJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, organizationDerivedAuthoritySources.characterId),
    )
    .leftJoin(eveTokens, eq(eveTokens.characterId, organizationDerivedAuthoritySources.characterId))
    .where(
      and(
        eq(organizationDerivedAuthoritySources.deploymentId, 1),
        eq(organizationDerivedAuthoritySources.organizationVersion, organizationVersion),
        eq(organizationDerivedAuthoritySources.userId, userId),
        eq(organizationDerivedAuthoritySources.role, 'director'),
      ),
    )
}

function evaluateSource(
  source: SourceRow,
  userId: string,
  organization: OrganizationBoundary,
  enabled: boolean,
  now: Date,
): EffectiveAuthoritySource {
  const decision = evaluateDerivedDirectorSource(
    {
      enabled,
      organization,
      authorityCorporationId: source.authorityCorporationId,
      affiliation: {
        corporationId: source.currentCorporationId ?? 0,
        allianceId: source.currentAllianceId,
      },
      requiredScope: source.requiredScope,
      scopes: source.currentScopes ?? [],
      roles: { roles: source.directorRolePresent ? ['Director'] : [] },
      lifecycleCurrent:
        source.currentUserId === userId &&
        source.currentSubjectLifecycleId === source.sourceSubjectLifecycleId,
      authorizationGenerationCurrent:
        source.currentAuthorizationGeneration === source.authorizationGeneration,
      blocked: false,
      evidence: source,
    },
    now,
  )
  return { sourceId: source.sourceId, characterId: source.characterId, state: decision.state }
}

function noAuthority(): EffectiveOrganizationAuthority {
  return {
    organizationOwner: false,
    explicitDirector: false,
    derivedDirector: false,
    director: false,
    degraded: false,
    ownerSource: null,
    derivedSources: [],
  }
}
