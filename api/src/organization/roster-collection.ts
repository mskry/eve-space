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

type Transaction = Pick<typeof db, 'delete' | 'insert' | 'select'>
type SourceExecutionDatabase = Pick<typeof db, 'select'>

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
      sourceId: organizationCorporationSources.sourceId,
      characterId: organizationCorporationSources.characterId,
      corporationId: organizationCorporationSources.corporationId,
      sourceUserId: organizationCorporationSources.sourceUserId,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
      authorizationGeneration: organizationCorporationSources.authorizationGeneration,
      observedCorporationId: organizationCorporationSources.observedCorporationId,
      observedAllianceId: organizationCorporationSources.observedAllianceId,
      requiredScope: organizationCorporationSources.requiredScope,
      directorRolePresent: organizationCorporationSources.directorRolePresent,
      status: organizationCorporationSources.status,
      freshUntil: organizationCorporationSources.freshUntil,
      graceUntil: organizationCorporationSources.graceUntil,
      invalidatedAt: organizationCorporationSources.invalidatedAt,
      currentUserId: characters.userId,
      currentCorporationId: characters.corporationId,
      currentAllianceId: characters.allianceId,
      currentCharacterLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      currentAuthorizationGeneration: eveTokens.tokenVersion,
      scopes: eveTokens.scopes,
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
  )
    return false
  const [corporationLifecycle] = await database
    .select({ sourceId: platformSubjectLifecycles.corporationSourceId })
    .from(platformSubjectLifecycles)
    .where(eq(platformSubjectLifecycles.subjectLifecycleId, input.corporationSubjectLifecycleId))
  if (corporationLifecycle?.sourceId !== source.sourceId) return false
  return resolveAuthorityEvidenceState(source, input.now ?? new Date()) === 'fresh'
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
      and source.fresh_until > ${(input.now ?? new Date()).toISOString()}::text::timestamptz
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
      sourceId: organizationCorporationSources.sourceId,
      characterId: organizationCorporationSources.characterId,
      corporationId: characters.corporationId,
      affiliationResolutionState: characters.affiliationResolutionState,
      affiliationCheckedAt: characters.affiliationCheckedAt,
      nextAffiliationCheck: characters.nextAffiliationCheck,
      tokenVersion: eveTokens.tokenVersion,
      scopes: eveTokens.scopes,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
      sourceAuthorizationGeneration: organizationCorporationSources.authorizationGeneration,
      sourceStatus: organizationCorporationSources.status,
      sourceFreshUntil: organizationCorporationSources.freshUntil,
      sourceGraceUntil: organizationCorporationSources.graceUntil,
      sourceInvalidatedAt: organizationCorporationSources.invalidatedAt,
      currentSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
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
        status: source.sourceStatus,
        freshUntil: source.sourceFreshUntil,
        graceUntil: source.sourceGraceUntil,
        invalidatedAt: source.sourceInvalidatedAt,
      },
      new Date(),
    ) !== 'fresh' ||
    !source.scopes.includes(corporationMembershipScope)
  )
    return { outcome: 'obsolete' as const }

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
  if (input.characterIds.length > 0)
    await transaction.insert(organizationCorporationRosterObservations).values(
      input.characterIds.map((characterId) => ({
        deploymentId: 1,
        organizationVersion: input.organizationVersion,
        corporationId: input.corporationId,
        characterId,
        sourceId: input.sourceId,
        authorizationGeneration: input.tokenVersion,
        observedAt: input.validatedAt,
      })),
    )
  return { outcome: 'refreshed' as const, characterIds: input.characterIds }
}
