import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characterCorporationRoleContents,
  characterCorporationRoleObservations,
  characters,
  deploymentSettings,
  eveTokens,
  platformSubjectLifecycles,
  type CorporationRoleObservationStatus,
} from '../db/schema.js'
import {
  evaluateCorporationRolePredicate,
  type ReviewedCorporationRolePredicate,
} from './corporation-role-canonical.js'
import { getCharacterEsiScope } from '../esi-gateway/catalog-interface.js'

export const corporationRoleObservationRequiredScope = getCharacterEsiScope(
  'character-corporation-roles',
)

export type CorporationRoleEvidenceDatabase = Pick<typeof db, 'select'>

export interface CorporationRoleSourceBinding {
  readonly organizationVersion: number
  readonly userId: string
  readonly characterId: number
  readonly subjectLifecycleId: string
  readonly affiliationPeriodRevision: string
  readonly authorityCorporationId: number
  readonly authorizationGeneration: number
}

export type CorporationRoleEvidenceState = 'fresh' | 'degraded' | 'invalid' | 'pending'

export interface CorporationRoleEvidence {
  readonly binding: CorporationRoleSourceBinding
  readonly status: CorporationRoleObservationStatus
  readonly state: CorporationRoleEvidenceState
  readonly roleRevision: string | null
  readonly validatedAt: Date | null
  readonly freshUntil: Date | null
  readonly degradedUntil: Date | null
  readonly nextRefreshAt: Date | null
}

export interface CorporationRolePredicateEvaluation {
  readonly bindingCurrent: boolean
  readonly outcome: 'satisfied' | 'unsatisfied' | 'unavailable'
  readonly evidence: CorporationRoleEvidence | null
}

export interface CorporationRoleEvidenceDiagnostics {
  readonly pending: number
  readonly fresh: number
  readonly degraded: number
  readonly invalid: number
  readonly overdue: number
}

export const resolveCorporationRoleEvidenceState = (
  evidence: Pick<CorporationRoleEvidence, 'status' | 'freshUntil' | 'degradedUntil'>,
  now: Date,
): CorporationRoleEvidenceState => {
  if (evidence.status === 'pending') {
    return 'pending'
  }
  if (evidence.status === 'invalid' || !evidence.freshUntil) {
    return 'invalid'
  }
  if (now < evidence.freshUntil) {
    return 'fresh'
  }
  if (evidence.status === 'degraded' && evidence.degradedUntil && now < evidence.degradedUntil) {
    return 'degraded'
  }
  return 'invalid'
}

const evidenceSelection = {
  affiliationPeriodRevision: characterCorporationRoleObservations.affiliationPeriodRevision,
  authorityCorporationId: characterCorporationRoleObservations.authorityCorporationId,
  authorizationGeneration: characterCorporationRoleObservations.authorizationGeneration,
  characterId: characterCorporationRoleObservations.characterId,
  degradedUntil: characterCorporationRoleObservations.degradedUntil,
  freshUntil: characterCorporationRoleObservations.freshUntil,
  nextRefreshAt: characterCorporationRoleObservations.nextRefreshAt,
  observationId: characterCorporationRoleObservations.observationId,
  organizationVersion: characterCorporationRoleObservations.organizationVersion,
  roleRevision: characterCorporationRoleObservations.roleRevision,
  status: characterCorporationRoleObservations.status,
  subjectLifecycleId: characterCorporationRoleObservations.sourceSubjectLifecycleId,
  userId: characterCorporationRoleObservations.userId,
  validatedAt: characterCorporationRoleObservations.validatedAt,
}

interface EvidenceRow extends CorporationRoleSourceBinding {
  readonly status: CorporationRoleObservationStatus
  readonly roleRevision: string | null
  readonly validatedAt: Date | null
  readonly freshUntil: Date | null
  readonly degradedUntil: Date | null
  readonly nextRefreshAt: Date | null
}

const bindingPredicate = (binding: CorporationRoleSourceBinding) =>
  and(
    eq(characterCorporationRoleObservations.deploymentId, 1),
    eq(characterCorporationRoleObservations.organizationVersion, binding.organizationVersion),
    eq(characterCorporationRoleObservations.sourceSubjectLifecycleId, binding.subjectLifecycleId),
    eq(
      characterCorporationRoleObservations.affiliationPeriodRevision,
      binding.affiliationPeriodRevision,
    ),
    eq(characterCorporationRoleObservations.authorityCorporationId, binding.authorityCorporationId),
    eq(
      characterCorporationRoleObservations.authorizationGeneration,
      binding.authorizationGeneration,
    ),
  )

export const toCorporationRoleEvidence = (
  row: EvidenceRow,
  now: Date,
): CorporationRoleEvidence => ({
  binding: {
    affiliationPeriodRevision: row.affiliationPeriodRevision,
    authorityCorporationId: row.authorityCorporationId,
    authorizationGeneration: row.authorizationGeneration,
    characterId: row.characterId,
    organizationVersion: row.organizationVersion,
    subjectLifecycleId: row.subjectLifecycleId,
    userId: row.userId,
  },
  degradedUntil: row.degradedUntil,
  freshUntil: row.freshUntil,
  nextRefreshAt: row.nextRefreshAt,
  roleRevision: row.roleRevision,
  state: resolveCorporationRoleEvidenceState(row, now),
  status: row.status,
  validatedAt: row.validatedAt,
})

export const loadCorporationRoleEvidence = async (
  database: CorporationRoleEvidenceDatabase,
  binding: CorporationRoleSourceBinding,
  now = new Date(),
) => {
  const [row] = await database
    .select(evidenceSelection)
    .from(characterCorporationRoleObservations)
    .where(
      and(
        bindingPredicate(binding),
        eq(characterCorporationRoleObservations.characterId, binding.characterId),
        eq(characterCorporationRoleObservations.userId, binding.userId),
      ),
    )
  return row ? toCorporationRoleEvidence(row, now) : null
}

const isBindingCurrent = async (
  database: CorporationRoleEvidenceDatabase,
  binding: CorporationRoleSourceBinding,
  requiredScope: string,
) => {
  const [current] = await database
    .select({ characterId: characters.characterId })
    .from(characters)
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .where(
      and(
        eq(characters.characterId, binding.characterId),
        eq(characters.userId, binding.userId),
        eq(characters.corporationId, binding.authorityCorporationId),
        eq(characters.affiliationPeriodRevision, binding.affiliationPeriodRevision),
        eq(platformSubjectLifecycles.subjectLifecycleId, binding.subjectLifecycleId),
        eq(eveTokens.tokenVersion, binding.authorizationGeneration),
        sql`${eveTokens.scopes} @> ${JSON.stringify([requiredScope])}::jsonb`,
      ),
    )
  return current !== undefined
}

export const evaluateCorporationRoleEvidence = async (
  database: CorporationRoleEvidenceDatabase,
  input: {
    readonly binding: CorporationRoleSourceBinding
    readonly requiredScope: string
    readonly predicate: ReviewedCorporationRolePredicate
    readonly now?: Date
  },
): Promise<CorporationRolePredicateEvaluation> => {
  const now = input.now ?? new Date()
  if (!(await isBindingCurrent(database, input.binding, input.requiredScope))) {
    return { bindingCurrent: false, evidence: null, outcome: 'unavailable' }
  }
  const [row] = await database
    .select({
      ...evidenceSelection,
      roles: characterCorporationRoleContents.roles,
      rolesAtBase: characterCorporationRoleContents.rolesAtBase,
      rolesAtHeadquarters: characterCorporationRoleContents.rolesAtHeadquarters,
      rolesAtOther: characterCorporationRoleContents.rolesAtOther,
    })
    .from(characterCorporationRoleObservations)
    .leftJoin(
      characterCorporationRoleContents,
      eq(
        characterCorporationRoleContents.observationId,
        characterCorporationRoleObservations.observationId,
      ),
    )
    .where(
      and(
        bindingPredicate(input.binding),
        eq(characterCorporationRoleObservations.characterId, input.binding.characterId),
        eq(characterCorporationRoleObservations.userId, input.binding.userId),
      ),
    )
  if (!row) {
    return { bindingCurrent: true, evidence: null, outcome: 'unavailable' }
  }
  const evidence = toCorporationRoleEvidence(row, now)
  if (
    (evidence.state !== 'fresh' && evidence.state !== 'degraded') ||
    !row.roles ||
    !row.rolesAtBase ||
    !row.rolesAtHeadquarters ||
    !row.rolesAtOther
  ) {
    return { bindingCurrent: true, evidence, outcome: 'unavailable' }
  }
  const satisfied = evaluateCorporationRolePredicate(
    {
      roles: row.roles,
      rolesAtBase: row.rolesAtBase,
      rolesAtHeadquarters: row.rolesAtHeadquarters,
      rolesAtOther: row.rolesAtOther,
    },
    input.predicate,
  )
  return { bindingCurrent: true, evidence, outcome: satisfied ? 'satisfied' : 'unsatisfied' }
}

export const loadCorporationRoleEvidenceDiagnostics = async (
  database: CorporationRoleEvidenceDatabase = db,
  now = new Date(),
  overdueToleranceMilliseconds = 15 * 60 * 1000,
): Promise<CorporationRoleEvidenceDiagnostics> => {
  const overdueBefore = new Date(now.getTime() - overdueToleranceMilliseconds).toISOString()
  const nowValue = now.toISOString()
  const [counts] = await database
    .select({
      degraded: sql<number>`count(*) filter (
        where ${characterCorporationRoleObservations.status} = 'degraded'
          and ${characterCorporationRoleObservations.degradedUntil} > ${nowValue}::timestamptz
      )::integer`,
      fresh: sql<number>`count(*) filter (
        where ${characterCorporationRoleObservations.status} = 'fresh'
          and ${characterCorporationRoleObservations.freshUntil} > ${nowValue}::timestamptz
      )::integer`,
      invalid: sql<number>`count(*) filter (
        where ${characterCorporationRoleObservations.status} = 'invalid'
          or (
            ${characterCorporationRoleObservations.status} in ('fresh', 'degraded')
            and ${characterCorporationRoleObservations.freshUntil} <= ${nowValue}::timestamptz
            and coalesce(${characterCorporationRoleObservations.degradedUntil}, ${characterCorporationRoleObservations.freshUntil}) <= ${nowValue}::timestamptz
          )
      )::integer`,
      overdue: sql<number>`count(*) filter (
        where ${characterCorporationRoleObservations.status} <> 'invalid'
          and ${characterCorporationRoleObservations.nextRefreshAt} < ${overdueBefore}::timestamptz
      )::integer`,
      pending: sql<number>`count(*) filter (
        where ${characterCorporationRoleObservations.status} = 'pending'
      )::integer`,
    })
    .from(characterCorporationRoleObservations)
  return {
    degraded: counts?.degraded ?? 0,
    fresh: counts?.fresh ?? 0,
    invalid: counts?.invalid ?? 0,
    overdue: counts?.overdue ?? 0,
    pending: counts?.pending ?? 0,
  }
}

export const loadCurrentCorporationRoleBinding = async (
  database: CorporationRoleEvidenceDatabase,
  input: { readonly characterId: number; readonly userId: string },
): Promise<CorporationRoleSourceBinding | null> => {
  const [current] = await database
    .select({
      affiliationPeriodRevision: characters.affiliationPeriodRevision,
      affiliationResolutionState: characters.affiliationResolutionState,
      authorityCorporationId: characters.corporationId,
      authorizationGeneration: eveTokens.tokenVersion,
      characterId: characters.characterId,
      organizationVersion: deploymentSettings.organizationVersion,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      userId: characters.userId,
    })
    .from(characters)
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .innerJoin(deploymentSettings, eq(deploymentSettings.id, 1))
    .where(and(eq(characters.characterId, input.characterId), eq(characters.userId, input.userId)))
  if (current?.affiliationResolutionState !== 'resolved') {
    return null
  }
  return {
    affiliationPeriodRevision: current.affiliationPeriodRevision,
    authorityCorporationId: current.authorityCorporationId,
    authorizationGeneration: current.authorizationGeneration,
    characterId: current.characterId,
    organizationVersion: current.organizationVersion,
    subjectLifecycleId: current.subjectLifecycleId,
    userId: current.userId,
  }
}
