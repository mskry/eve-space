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
import {
  resolveSourceRoleEvidenceState,
  weakestAuthorityEvidenceState,
} from './source-role-evidence.js'

type Database = DatabaseTransaction | typeof db

interface SourceRow {
  sourceId: string
  userId: string
  organizationVersion: number
  affiliationPeriodRevision: string | null
  roleEvidenceRevision: string
  legacyRoleContinuityUntil: Date | null
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
  currentAllianceId: characters.allianceId,
  currentAuthorizationGeneration: eveTokens.tokenVersion,
  currentCorporationId: characters.corporationId,
  currentScopes: eveTokens.scopes,
  currentSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
  currentUserId: characters.userId,
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
  ) {
    return noAuthority()
  }

  const organization = await loadOrganization(database, organizationVersion)
  if (
    !organization ||
    (await hasActiveOrganizationMemberBlock(database, organizationVersion, userId))
  ) {
    return noAuthority()
  }

  const owner = await loadOwnerSource(database, organizationVersion, userId)
  const ownerSource = owner
    ? await evaluateSource(database, owner, userId, organization, true, now)
    : null
  const explicitDirector = await hasExplicitDirector(database, organizationVersion, userId)
  const derivedRows = organization.derivedDirectorAuthorityEnabled
    ? await loadDerivedSources(database, organizationVersion, userId)
    : []
  const derivedSources = await Promise.all(
    derivedRows.map((source) => evaluateSource(database, source, userId, organization, true, now)),
  )
  const organizationOwner = ownerSource?.state
    ? canUseAuthoritySource(ownerSource.state, operation)
    : false
  const derivedDirector = derivedSources.some(({ state }) =>
    canUseAuthoritySource(state, operation),
  )

  return {
    degraded:
      ownerSource?.state === 'degraded' || derivedSources.some(({ state }) => state === 'degraded'),
    derivedDirector,
    derivedSources,
    director: explicitDirector || derivedDirector,
    explicitDirector,
    organizationOwner,
    ownerSource,
  }
}

async function loadOrganization(database: Database, organizationVersion: number) {
  const [organization] = await database
    .select({
      derivedDirectorAuthorityEnabled: deploymentSettings.derivedDirectorAuthorityEnabled,
      organizationId: deploymentSettings.organizationId,
      organizationType: deploymentSettings.organizationType,
      organizationVersion: deploymentSettings.organizationVersion,
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
      affiliationPeriodRevision: organizationAuthorityEvidence.affiliationPeriodRevision,
      authorityCorporationId: organizationAuthorityEvidence.authorityCorporationId,
      authorizationGeneration: organizationAuthorityEvidence.authorizationGeneration,
      characterId: organizationAuthorityEvidence.characterId,
      directorRolePresent: organizationAuthorityEvidence.directorRolePresent,
      freshUntil: organizationAuthorityEvidence.freshUntil,
      graceUntil: organizationAuthorityEvidence.graceUntil,
      invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      legacyRoleContinuityUntil: organizationAuthorityEvidence.legacyRoleContinuityUntil,
      observedAllianceId: organizationAuthorityEvidence.observedAllianceId,
      organizationVersion: organizationAuthorityEvidence.organizationVersion,
      requiredScope: organizationAuthorityEvidence.requiredScope,
      roleEvidenceRevision: organizationAuthorityEvidence.roleEvidenceRevision,
      sourceId: organizationAuthorityEvidence.evidenceId,
      sourceSubjectLifecycleId: organizationAuthorityEvidence.sourceSubjectLifecycleId,
      status: organizationAuthorityEvidence.status,
      userId: organizationAuthorityEvidence.userId,
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
      affiliationPeriodRevision: organizationDerivedAuthoritySources.affiliationPeriodRevision,
      authorityCorporationId: organizationDerivedAuthoritySources.authorityCorporationId,
      authorizationGeneration: organizationDerivedAuthoritySources.authorizationGeneration,
      characterId: organizationDerivedAuthoritySources.characterId,
      directorRolePresent: organizationDerivedAuthoritySources.directorRolePresent,
      freshUntil: organizationDerivedAuthoritySources.freshUntil,
      graceUntil: organizationDerivedAuthoritySources.graceUntil,
      invalidatedAt: organizationDerivedAuthoritySources.invalidatedAt,
      legacyRoleContinuityUntil: organizationDerivedAuthoritySources.legacyRoleContinuityUntil,
      observedAllianceId: organizationDerivedAuthoritySources.observedAllianceId,
      organizationVersion: organizationDerivedAuthoritySources.organizationVersion,
      requiredScope: organizationDerivedAuthoritySources.requiredScope,
      roleEvidenceRevision: organizationDerivedAuthoritySources.roleEvidenceRevision,
      sourceId: organizationDerivedAuthoritySources.sourceId,
      sourceSubjectLifecycleId: organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
      status: organizationDerivedAuthoritySources.status,
      userId: organizationDerivedAuthoritySources.userId,
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

async function evaluateSource(
  database: Database,
  source: SourceRow,
  userId: string,
  organization: OrganizationBoundary,
  enabled: boolean,
  now: Date,
): Promise<EffectiveAuthoritySource> {
  const decision = evaluateDerivedDirectorSource(
    {
      affiliation: {
        allianceId: source.currentAllianceId,
        corporationId: source.currentCorporationId ?? 0,
      },
      authorityCorporationId: source.authorityCorporationId,
      authorizationGenerationCurrent:
        source.currentAuthorizationGeneration === source.authorizationGeneration,
      blocked: false,
      enabled,
      evidence: source,
      lifecycleCurrent:
        source.currentUserId === userId &&
        source.currentSubjectLifecycleId === source.sourceSubjectLifecycleId,
      organization,
      requiredScope: source.requiredScope,
      roles: { roles: source.directorRolePresent ? ['Director'] : [] },
      scopes: source.currentScopes ?? [],
    },
    now,
  )
  const state =
    decision.state === 'invalid'
      ? decision.state
      : weakestAuthorityEvidenceState(
          decision.state,
          await resolveSourceRoleEvidenceState(
            database,
            {
              affiliationPeriodRevision: source.affiliationPeriodRevision,
              authorityCorporationId: source.authorityCorporationId,
              authorizationGeneration: source.authorizationGeneration,
              characterId: source.characterId,
              legacyRoleContinuityUntil: source.legacyRoleContinuityUntil,
              organizationVersion: source.organizationVersion,
              roleEvidenceRevision: source.roleEvidenceRevision,
              sourceSubjectLifecycleId: source.sourceSubjectLifecycleId,
              userId: source.userId,
            },
            now,
          ),
        )
  return { characterId: source.characterId, sourceId: source.sourceId, state }
}

function noAuthority(): EffectiveOrganizationAuthority {
  return {
    degraded: false,
    derivedDirector: false,
    derivedSources: [],
    director: false,
    explicitDirector: false,
    organizationOwner: false,
    ownerSource: null,
  }
}
