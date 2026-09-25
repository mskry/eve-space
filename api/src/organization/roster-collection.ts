import { and, eq, isNull } from 'drizzle-orm'
import type postgres from 'postgres'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationCorporationRosterObservations,
  organizationCorporationSources,
  organizationManagedCorporations,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { resolveAuthorityEvidenceState } from './authority-policy.js'
import { resolveAffiliationFreshness } from './affiliation-freshness.js'
import { corporationMembershipScope } from './corporation-membership.js'
import { resolveSourceRoleEvidenceState } from './source-role-evidence.js'

type Transaction = Pick<typeof db, 'delete' | 'insert' | 'select'>
type SourceExecutionDatabase = Pick<typeof db, 'select'>

const resolveCorporationSourceRoleEvidence = (
  database: SourceExecutionDatabase,
  source: {
    readonly affiliationPeriodRevision: string | null
    readonly authorizationGeneration: number
    readonly characterId: number | null
    readonly corporationId: number
    readonly legacyRoleContinuityUntil: Date | null
    readonly organizationVersion: number
    readonly roleEvidenceRevision: string
    readonly sourceSubjectLifecycleId: string
    readonly sourceUserId: string
  },
  now: Date,
) =>
  source.characterId === null
    ? Promise.resolve('invalid' as const)
    : resolveSourceRoleEvidenceState(
        database,
        {
          affiliationPeriodRevision: source.affiliationPeriodRevision,
          authorityCorporationId: source.corporationId,
          authorizationGeneration: source.authorizationGeneration,
          characterId: source.characterId,
          legacyRoleContinuityUntil: source.legacyRoleContinuityUntil,
          organizationVersion: source.organizationVersion,
          roleEvidenceRevision: source.roleEvidenceRevision,
          sourceSubjectLifecycleId: source.sourceSubjectLifecycleId,
          userId: source.sourceUserId,
        },
        now,
      )

export async function isCorporationSourceExecutionCurrent(
  input: {
    corporationSubjectLifecycleId: string
    characterId: number
    characterSubjectLifecycleId: string
    authorizationGeneration: number
    now?: Date
  },
  database: SourceExecutionDatabase = db,
) {
  const [source] = await database
    .select({
      affiliationPeriodRevision: organizationCorporationSources.affiliationPeriodRevision,
      authorizationGeneration: organizationCorporationSources.authorizationGeneration,
      characterId: organizationCorporationSources.characterId,
      corporationId: organizationCorporationSources.corporationId,
      currentAllianceId: characters.allianceId,
      currentAuthorizationGeneration: eveTokens.tokenVersion,
      currentCharacterLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      currentCorporationId: characters.corporationId,
      currentUserId: characters.userId,
      directorRolePresent: organizationCorporationSources.directorRolePresent,
      freshUntil: organizationCorporationSources.freshUntil,
      graceUntil: organizationCorporationSources.graceUntil,
      invalidatedAt: organizationCorporationSources.invalidatedAt,
      legacyRoleContinuityUntil: organizationCorporationSources.legacyRoleContinuityUntil,
      observedAllianceId: organizationCorporationSources.observedAllianceId,
      observedCorporationId: organizationCorporationSources.observedCorporationId,
      organizationVersion: organizationCorporationSources.organizationVersion,
      requiredScope: organizationCorporationSources.requiredScope,
      roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
      scopes: eveTokens.scopes,
      sourceId: organizationCorporationSources.sourceId,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
      sourceUserId: organizationCorporationSources.sourceUserId,
      status: organizationCorporationSources.status,
    })
    .from(organizationCorporationSources)
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, organizationCorporationSources.deploymentId),
        eq(
          deploymentSettings.organizationVersion,
          organizationCorporationSources.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      organizationManagedCorporations,
      and(
        eq(
          organizationManagedCorporations.deploymentId,
          organizationCorporationSources.deploymentId,
        ),
        eq(
          organizationManagedCorporations.organizationVersion,
          organizationCorporationSources.organizationVersion,
        ),
        eq(
          organizationManagedCorporations.corporationId,
          organizationCorporationSources.corporationId,
        ),
        eq(organizationManagedCorporations.isCurrent, true),
      ),
    )
    .innerJoin(characters, eq(characters.characterId, organizationCorporationSources.characterId))
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, organizationCorporationSources.characterId),
    )
    .innerJoin(eveTokens, eq(eveTokens.characterId, organizationCorporationSources.characterId))
    .where(
      and(
        eq(organizationCorporationSources.characterId, input.characterId),
        eq(
          organizationCorporationSources.sourceSubjectLifecycleId,
          input.characterSubjectLifecycleId,
        ),
        eq(organizationCorporationSources.authorizationGeneration, input.authorizationGeneration),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
    .limit(1)
    .for('share')
  if (
    source?.characterId !== input.characterId ||
    source.sourceUserId !== source.currentUserId ||
    source.corporationId !== source.currentCorporationId ||
    source.observedCorporationId !== source.currentCorporationId ||
    source.observedAllianceId !== source.currentAllianceId ||
    source.currentCharacterLifecycleId !== input.characterSubjectLifecycleId ||
    source.currentAuthorizationGeneration !== input.authorizationGeneration ||
    !source.scopes.includes(source.requiredScope) ||
    source.directorRolePresent !== true
  ) {
    return false
  }
  const [corporationLifecycle] = await database
    .select({ sourceId: platformSubjectLifecycles.corporationSourceId })
    .from(platformSubjectLifecycles)
    .where(eq(platformSubjectLifecycles.subjectLifecycleId, input.corporationSubjectLifecycleId))
  if (corporationLifecycle?.sourceId !== source.sourceId) {
    return false
  }
  const now = input.now ?? new Date()
  return (
    resolveAuthorityEvidenceState(source, now) === 'fresh' &&
    (await resolveCorporationSourceRoleEvidence(database, source, now)) === 'fresh'
  )
}

export async function lockCorporationSourceExecutionCurrent(
  transaction: postgres.TransactionSql,
  input: {
    corporationSubjectLifecycleId: string
    characterId: number
    characterSubjectLifecycleId: string
    authorizationGeneration: number
    now?: Date
  },
) {
  const nowValue = (input.now ?? new Date()).toISOString()
  const [source] = await transaction<{ sourceId: string }[]>`
    select source.source_id as "sourceId"
    from organization_corporation_sources source
    join deployment_settings settings
      on settings.id = source.deployment_id
      and settings.organization_version = source.organization_version
    join organization_managed_corporations managed
      on managed.deployment_id = source.deployment_id
      and managed.organization_version = source.organization_version
      and managed.corporation_id = source.corporation_id
      and managed.is_current
    join platform_subject_lifecycles corporation_lifecycle
      on corporation_lifecycle.corporation_source_id = source.source_id
      and corporation_lifecycle.subject_kind = 'corporation'
    join characters character
      on character.character_id = source.character_id
      and character.user_id = source.source_user_id
      and character.corporation_id = source.corporation_id
      and character.corporation_id = source.observed_corporation_id
      and character.alliance_id is not distinct from source.observed_alliance_id
    join platform_subject_lifecycles character_lifecycle
      on character_lifecycle.character_id = character.character_id
      and is_character_subject_kind(character_lifecycle.subject_kind)
    join eve_tokens token
      on token.character_id = character.character_id
      and token.token_version = source.authorization_generation
      and token.scopes @> jsonb_build_array(source.required_scope)
    where source.character_id = ${input.characterId}
      and source.source_subject_lifecycle_id = ${input.characterSubjectLifecycleId}
      and source.authorization_generation = ${input.authorizationGeneration}
      and corporation_lifecycle.subject_lifecycle_id = ${input.corporationSubjectLifecycleId}
      and character_lifecycle.subject_lifecycle_id = ${input.characterSubjectLifecycleId}
      and source.revoked_at is null
      and source.invalidated_at is null
      and source.status = 'fresh'
      and source.director_role_present
      and source.fresh_until > ${nowValue}::text::timestamptz
      and source.affiliation_period_revision = character.affiliation_period_revision
      and (
        exists (
          select 1
          from character_corporation_role_observations observation
          where observation.deployment_id = source.deployment_id
            and observation.organization_version = source.organization_version
            and observation.character_id = source.character_id
            and observation.user_id = source.source_user_id
            and observation.source_subject_lifecycle_id = source.source_subject_lifecycle_id
            and observation.affiliation_period_revision = source.affiliation_period_revision
            and observation.authority_corporation_id = source.corporation_id
            and observation.authorization_generation = source.authorization_generation
            and observation.role_revision::text = source.role_evidence_revision
            and observation.status = 'fresh'
            and observation.fresh_until > ${nowValue}::text::timestamptz
        )
        or (
          source.legacy_role_continuity_until > ${nowValue}::text::timestamptz
          and not exists (
            select 1
            from character_corporation_role_observations observation
            where observation.deployment_id = source.deployment_id
              and observation.organization_version = source.organization_version
              and observation.source_subject_lifecycle_id = source.source_subject_lifecycle_id
              and observation.affiliation_period_revision = source.affiliation_period_revision
              and observation.authority_corporation_id = source.corporation_id
              and observation.authorization_generation = source.authorization_generation
              and observation.status <> 'pending'
          )
        )
      )
    for share of source
  `
  return Boolean(source)
}

export async function materializeCorporationRoster(
  transaction: Transaction,
  input: {
    organizationVersion: number
    corporationId: number
    sourceId: string
    characterId: number
    tokenVersion: number
    characterIds: number[]
    validatedAt: Date
  },
) {
  const [source] = await transaction
    .select({
      affiliationCheckedAt: characters.affiliationCheckedAt,
      affiliationResolutionState: characters.affiliationResolutionState,
      characterId: organizationCorporationSources.characterId,
      corporationId: characters.corporationId,
      currentSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      nextAffiliationCheck: characters.nextAffiliationCheck,
      scopes: eveTokens.scopes,
      sourceAffiliationPeriodRevision: organizationCorporationSources.affiliationPeriodRevision,
      sourceAuthorizationGeneration: organizationCorporationSources.authorizationGeneration,
      sourceCorporationId: organizationCorporationSources.corporationId,
      sourceLegacyRoleContinuityUntil: organizationCorporationSources.legacyRoleContinuityUntil,
      sourceOrganizationVersion: organizationCorporationSources.organizationVersion,
      sourceRoleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
      sourceUserId: organizationCorporationSources.sourceUserId,
      sourceFreshUntil: organizationCorporationSources.freshUntil,
      sourceGraceUntil: organizationCorporationSources.graceUntil,
      sourceId: organizationCorporationSources.sourceId,
      sourceInvalidatedAt: organizationCorporationSources.invalidatedAt,
      sourceStatus: organizationCorporationSources.status,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
      tokenVersion: eveTokens.tokenVersion,
    })
    .from(organizationCorporationSources)
    .innerJoin(characters, eq(characters.characterId, organizationCorporationSources.characterId))
    .innerJoin(eveTokens, eq(eveTokens.characterId, organizationCorporationSources.characterId))
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, organizationCorporationSources.characterId),
    )
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, organizationCorporationSources.deploymentId),
        eq(deploymentSettings.organizationVersion, input.organizationVersion),
      ),
    )
    .innerJoin(
      organizationManagedCorporations,
      and(
        eq(
          organizationManagedCorporations.deploymentId,
          organizationCorporationSources.deploymentId,
        ),
        eq(organizationManagedCorporations.organizationVersion, input.organizationVersion),
        eq(organizationManagedCorporations.corporationId, input.corporationId),
        eq(organizationManagedCorporations.isCurrent, true),
      ),
    )
    .where(
      and(
        eq(organizationCorporationSources.sourceId, input.sourceId),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
    .for('update')
  if (
    source?.characterId !== input.characterId ||
    source.corporationId !== input.corporationId ||
    resolveAffiliationFreshness(source, new Date()) !== 'fresh' ||
    source.tokenVersion !== input.tokenVersion ||
    source.sourceAuthorizationGeneration !== input.tokenVersion ||
    source.sourceSubjectLifecycleId !== source.currentSubjectLifecycleId ||
    resolveAuthorityEvidenceState(
      {
        freshUntil: source.sourceFreshUntil,
        graceUntil: source.sourceGraceUntil,
        invalidatedAt: source.sourceInvalidatedAt,
        status: source.sourceStatus,
      },
      new Date(),
    ) !== 'fresh' ||
    !source.scopes.includes(corporationMembershipScope) ||
    (await resolveCorporationSourceRoleEvidence(
      transaction,
      {
        affiliationPeriodRevision: source.sourceAffiliationPeriodRevision,
        authorizationGeneration: source.sourceAuthorizationGeneration,
        characterId: source.characterId,
        corporationId: source.sourceCorporationId,
        legacyRoleContinuityUntil: source.sourceLegacyRoleContinuityUntil,
        organizationVersion: source.sourceOrganizationVersion,
        roleEvidenceRevision: source.sourceRoleEvidenceRevision,
        sourceSubjectLifecycleId: source.sourceSubjectLifecycleId,
        sourceUserId: source.sourceUserId,
      },
      new Date(),
    )) !== 'fresh'
  ) {
    return { outcome: 'obsolete' as const }
  }

  await transaction
    .delete(organizationCorporationRosterObservations)
    .where(
      and(
        eq(organizationCorporationRosterObservations.deploymentId, 1),
        eq(
          organizationCorporationRosterObservations.organizationVersion,
          input.organizationVersion,
        ),
        eq(organizationCorporationRosterObservations.corporationId, input.corporationId),
      ),
    )
  if (input.characterIds.length > 0) {
    await transaction.insert(organizationCorporationRosterObservations).values(
      input.characterIds.map((characterId) => ({
        authorizationGeneration: input.tokenVersion,
        characterId,
        corporationId: input.corporationId,
        deploymentId: 1,
        observedAt: input.validatedAt,
        organizationVersion: input.organizationVersion,
        sourceId: input.sourceId,
      })),
    )
  }
  return { characterIds: input.characterIds, outcome: 'refreshed' as const }
}
