import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type postgres from 'postgres'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characterCorporationRoleContents,
  characterCorporationRoleObservations,
  characters,
  deploymentSettings,
  eveTokens,
  organizationCorporationSources,
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

export interface CorporationResourceRoleRequest {
  readonly sourceId: string
  readonly corporationLifecycleId: string
  readonly binding: CorporationRoleSourceBinding
  readonly requiredScopes: readonly string[]
  readonly predicates: readonly ReviewedCorporationRolePredicate[]
}

export interface CorporationResourceRoleResult {
  readonly sourceId: string
  readonly binding: CorporationRoleSourceBinding
  readonly corporationLifecycleId: string
  readonly outcome: 'satisfied' | 'unsatisfied' | 'unavailable'
  readonly revision: string | null
  readonly freshUntil: Date | null
  readonly predicateOutcomes: Readonly<Partial<Record<ReviewedCorporationRolePredicate, boolean>>>
}

export interface CorporationResourceAuthorityCandidate {
  readonly corporationLifecycleId: string
  readonly corporationId: number
  readonly organizationVersion: number | null
  readonly characterId: number
  readonly characterLifecycleId: string
  readonly authorizationGeneration: number
  readonly requiredScopes: readonly string[]
  readonly predicates: readonly ReviewedCorporationRolePredicate[]
}

export interface CorporationResourceAuthorityVerdict {
  readonly outcome:
    | 'satisfied'
    | 'scope-missing'
    | 'source-invalid'
    | 'role-unsatisfied'
    | 'role-unavailable'
  readonly sourceId: string | null
  readonly roleRevision: string | null
  readonly validUntil: Date | null
  readonly missingScope?: string
  readonly sourceBinding: CorporationResourceSourceCorrelation | null
}

export interface CorporationResourceSourceCorrelation {
  readonly organizationVersion: number
  readonly characterId: number
  readonly characterLifecycleId: string
  readonly affiliationPeriodRevision: string | null
  readonly corporationId: number
  readonly authorizationGeneration: number
}

export interface CorporationRoleEvidenceDiagnostics {
  readonly pending: number
  readonly fresh: number
  readonly degraded: number
  readonly invalid: number
  readonly overdue: number
}

const corporationResourceLifecycle = alias(
  platformSubjectLifecycles,
  'corporation_resource_lifecycle',
)
const maximumRoleBatchSize = 64
const maximumRoleRequirements = 16

const loadCorporationResourceRoleRows = async (
  database: CorporationRoleEvidenceDatabase | DatabaseTransaction,
  requests: readonly CorporationResourceRoleRequest[],
  lock: boolean,
  sqlConnection?: postgres.Sql | postgres.TransactionSql,
): Promise<readonly CorporationResourceRoleRow[]> => {
  if (
    requests.length > maximumRoleBatchSize ||
    requests.some(
      (request) =>
        request.predicates.length === 0 ||
        request.predicates.length > maximumRoleRequirements ||
        request.requiredScopes.length > maximumRoleRequirements,
    )
  ) {
    throw new RangeError('Corporation role evidence batch exceeds reviewed bounds')
  }
  if (requests.length === 0) return []
  const sourceIds = [...new Set(requests.map((request) => request.sourceId))]
  const query = database
    .select({
      sourceId: sql<string>`${organizationCorporationSources.sourceId}`.as('sourceId'),
      organizationVersion: sql<number>`${organizationCorporationSources.organizationVersion}`
        .mapWith(Number)
        .as('organizationVersion'),
      sourceUserId: sql<string>`${organizationCorporationSources.sourceUserId}`.as('sourceUserId'),
      characterId: sql<number>`${organizationCorporationSources.evidenceCharacterId}`
        .mapWith(Number)
        .as('characterId'),
      registeredCharacterId: sql<number | null>`${organizationCorporationSources.characterId}`
        .mapWith((value) => (value === null ? null : Number(value)))
        .as('registeredCharacterId'),
      corporationId: sql<number>`${organizationCorporationSources.corporationId}`
        .mapWith(Number)
        .as('corporationId'),
      sourceLifecycleId: sql<string>`${organizationCorporationSources.sourceSubjectLifecycleId}`.as(
        'sourceLifecycleId',
      ),
      affiliationPeriodRevision: sql<
        string | null
      >`${organizationCorporationSources.affiliationPeriodRevision}`.as(
        'affiliationPeriodRevision',
      ),
      authorizationGeneration:
        sql<number>`${organizationCorporationSources.authorizationGeneration}`.as(
          'authorizationGeneration',
        ),
      corporationLifecycleId: sql<string>`${corporationResourceLifecycle.subjectLifecycleId}`.as(
        'corporationLifecycleId',
      ),
      sourceRoleRevision: sql<string>`${organizationCorporationSources.roleEvidenceRevision}`.as(
        'sourceRoleRevision',
      ),
      characterUserId: sql<string>`${characters.userId}`.as('characterUserId'),
      characterCorporationId: sql<number>`${characters.corporationId}`
        .mapWith(Number)
        .as('characterCorporationId'),
      characterAffiliationRevision: sql<string>`${characters.affiliationPeriodRevision}`.as(
        'characterAffiliationRevision',
      ),
      characterLifecycleId: sql<string>`${platformSubjectLifecycles.subjectLifecycleId}`.as(
        'characterLifecycleId',
      ),
      tokenGeneration: sql<number>`${eveTokens.tokenVersion}`.as('tokenGeneration'),
      tokenScopes: sql<string[]>`${eveTokens.scopes}`.as('tokenScopes'),
      observationStatus:
        sql<CorporationRoleObservationStatus>`${characterCorporationRoleObservations.status}`.as(
          'observationStatus',
        ),
      observationRevision: sql<
        string | null
      >`${characterCorporationRoleObservations.roleRevision}`.as('observationRevision'),
      observationFreshUntil:
        sql<Date | null>`${characterCorporationRoleObservations.freshUntil}`.as(
          'observationFreshUntil',
        ),
      roles: sql<string[]>`${characterCorporationRoleContents.roles}`.as('roles'),
      rolesAtBase: sql<string[]>`${characterCorporationRoleContents.rolesAtBase}`.as('rolesAtBase'),
      rolesAtHeadquarters: sql<
        string[]
      >`${characterCorporationRoleContents.rolesAtHeadquarters}`.as('rolesAtHeadquarters'),
      rolesAtOther: sql<string[]>`${characterCorporationRoleContents.rolesAtOther}`.as(
        'rolesAtOther',
      ),
    })
    .from(organizationCorporationSources)
    .innerJoin(
      deploymentSettings,
      eq(
        deploymentSettings.organizationVersion,
        organizationCorporationSources.organizationVersion,
      ),
    )
    .innerJoin(
      characters,
      eq(characters.characterId, organizationCorporationSources.evidenceCharacterId),
    )
    .innerJoin(
      platformSubjectLifecycles,
      eq(
        platformSubjectLifecycles.subjectLifecycleId,
        organizationCorporationSources.sourceSubjectLifecycleId,
      ),
    )
    .innerJoin(
      corporationResourceLifecycle,
      eq(corporationResourceLifecycle.corporationSourceId, organizationCorporationSources.sourceId),
    )
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .innerJoin(
      characterCorporationRoleObservations,
      and(
        eq(
          characterCorporationRoleObservations.deploymentId,
          organizationCorporationSources.deploymentId,
        ),
        eq(
          characterCorporationRoleObservations.characterId,
          organizationCorporationSources.evidenceCharacterId,
        ),
        eq(
          characterCorporationRoleObservations.userId,
          organizationCorporationSources.sourceUserId,
        ),
        eq(
          characterCorporationRoleObservations.sourceSubjectLifecycleId,
          organizationCorporationSources.sourceSubjectLifecycleId,
        ),
        eq(
          characterCorporationRoleObservations.organizationVersion,
          organizationCorporationSources.organizationVersion,
        ),
        eq(
          characterCorporationRoleObservations.authorityCorporationId,
          organizationCorporationSources.corporationId,
        ),
        eq(
          characterCorporationRoleObservations.authorizationGeneration,
          organizationCorporationSources.authorizationGeneration,
        ),
        eq(
          characterCorporationRoleObservations.affiliationPeriodRevision,
          organizationCorporationSources.affiliationPeriodRevision,
        ),
      ),
    )
    .innerJoin(
      characterCorporationRoleContents,
      eq(
        characterCorporationRoleContents.observationId,
        characterCorporationRoleObservations.observationId,
      ),
    )
    .where(
      and(
        inArray(organizationCorporationSources.sourceId, sourceIds),
        eq(organizationCorporationSources.deploymentId, 1),
        isNull(organizationCorporationSources.revokedAt),
        isNull(organizationCorporationSources.invalidatedAt),
      ),
    )
    .orderBy(asc(organizationCorporationSources.sourceId))
  const selected = lock
    ? query.for('share', {
        of: [
          organizationCorporationSources,
          characters,
          platformSubjectLifecycles,
          corporationResourceLifecycle,
          eveTokens,
          characterCorporationRoleObservations,
          characterCorporationRoleContents,
        ],
      })
    : query
  if (sqlConnection) {
    const compiled = selected.toSQL()
    const params = compiled.params.map(String)
    const rawRows = await sqlConnection.unsafe<CorporationResourceRoleRow[]>(compiled.sql, params)
    return rawRows.map((row) =>
      Object.assign(row, {
        organizationVersion: Number(row.organizationVersion),
        characterId: Number(row.characterId),
        registeredCharacterId:
          row.registeredCharacterId === null ? null : Number(row.registeredCharacterId),
        corporationId: Number(row.corporationId),
        characterCorporationId: Number(row.characterCorporationId),
        observationFreshUntil:
          row.observationFreshUntil === null ? null : new Date(row.observationFreshUntil),
      }),
    )
  }
  return selected
}

interface CorporationResourceRoleRow {
  readonly sourceId: string
  readonly organizationVersion: number
  readonly sourceUserId: string
  readonly characterId: number
  readonly registeredCharacterId: number | null
  readonly corporationId: number
  readonly sourceLifecycleId: string
  readonly affiliationPeriodRevision: string | null
  readonly authorizationGeneration: number
  readonly corporationLifecycleId: string
  readonly sourceRoleRevision: string
  readonly characterUserId: string
  readonly characterCorporationId: number
  readonly characterAffiliationRevision: string
  readonly characterLifecycleId: string
  readonly tokenGeneration: number
  readonly tokenScopes: readonly string[]
  readonly observationStatus: CorporationRoleObservationStatus
  readonly observationRevision: string | null
  readonly observationFreshUntil: Date | null
  readonly roles: readonly string[]
  readonly rolesAtBase: readonly string[]
  readonly rolesAtHeadquarters: readonly string[]
  readonly rolesAtOther: readonly string[]
}

const unavailableCorporationResourceRole = (
  request: CorporationResourceRoleRequest,
): CorporationResourceRoleResult => ({
  binding: request.binding,
  corporationLifecycleId: request.corporationLifecycleId,
  freshUntil: null,
  outcome: 'unavailable',
  predicateOutcomes: {},
  revision: null,
  sourceId: request.sourceId,
})

const matchesCorporationRoleBinding = (
  request: CorporationResourceRoleRequest,
  row: CorporationResourceRoleRow | undefined,
): row is CorporationResourceRoleRow => {
  if (!row) return false
  const binding = request.binding
  return [
    row.organizationVersion === binding.organizationVersion,
    row.sourceUserId === binding.userId,
    row.characterId === binding.characterId,
    row.registeredCharacterId === binding.characterId,
    row.corporationId === binding.authorityCorporationId,
    row.sourceLifecycleId === binding.subjectLifecycleId,
    row.characterLifecycleId === binding.subjectLifecycleId,
    row.corporationLifecycleId === request.corporationLifecycleId,
    row.affiliationPeriodRevision === binding.affiliationPeriodRevision,
    row.characterAffiliationRevision === binding.affiliationPeriodRevision,
    row.characterUserId === binding.userId,
    row.characterCorporationId === binding.authorityCorporationId,
    row.authorizationGeneration === binding.authorizationGeneration,
    row.tokenGeneration === binding.authorizationGeneration,
  ].every(Boolean)
}

const evaluateCorporationResourceRoleRow = (
  request: CorporationResourceRoleRequest,
  row: CorporationResourceRoleRow | undefined,
  now: Date,
): CorporationResourceRoleResult => {
  if (!matchesCorporationRoleBinding(request, row) || !row.observationFreshUntil) {
    return unavailableCorporationResourceRole(request)
  }
  const freshUntil = new Date(row.observationFreshUntil)
  const evidenceCurrent = [
    row.observationRevision === row.sourceRoleRevision,
    row.observationStatus === 'fresh',
    !Number.isNaN(freshUntil.getTime()),
    now < freshUntil,
    row.tokenScopes.includes(corporationRoleObservationRequiredScope),
    request.requiredScopes.every((scope) => row.tokenScopes.includes(scope)),
  ].every(Boolean)
  if (!evidenceCurrent) return unavailableCorporationResourceRole(request)
  const roleSets = {
    roles: row.roles,
    rolesAtBase: row.rolesAtBase,
    rolesAtHeadquarters: row.rolesAtHeadquarters,
    rolesAtOther: row.rolesAtOther,
  }
  const predicateOutcomes: Partial<Record<ReviewedCorporationRolePredicate, boolean>> = {}
  for (const predicate of request.predicates) {
    predicateOutcomes[predicate] = evaluateCorporationRolePredicate(roleSets, predicate)
  }
  return {
    binding: request.binding,
    corporationLifecycleId: request.corporationLifecycleId,
    freshUntil,
    outcome: Object.values(predicateOutcomes).every(Boolean) ? 'satisfied' : 'unsatisfied',
    predicateOutcomes,
    revision: row.observationRevision,
    sourceId: request.sourceId,
  }
}

const evaluateCorporationResourceRolesBatch = async (
  database: CorporationRoleEvidenceDatabase | DatabaseTransaction,
  requests: readonly CorporationResourceRoleRequest[],
  now: Date,
  lock: boolean,
  sqlConnection?: postgres.Sql | postgres.TransactionSql,
): Promise<readonly CorporationResourceRoleResult[]> => {
  const rows = await loadCorporationResourceRoleRows(database, requests, lock, sqlConnection)
  const bySource = new Map(rows.map((row) => [row.sourceId, row]))
  return requests.map((request) =>
    evaluateCorporationResourceRoleRow(request, bySource.get(request.sourceId), now),
  )
}

export const evaluateCorporationResourceRoles = (
  database: CorporationRoleEvidenceDatabase,
  requests: readonly CorporationResourceRoleRequest[],
  now = new Date(),
): Promise<readonly CorporationResourceRoleResult[]> =>
  evaluateCorporationResourceRolesBatch(database, requests, now, false)

export const lockCorporationResourceRolesInTransaction = (
  transaction: DatabaseTransaction,
  requests: readonly CorporationResourceRoleRequest[],
  now = new Date(),
): Promise<readonly CorporationResourceRoleResult[]> =>
  evaluateCorporationResourceRolesBatch(transaction, requests, now, true)

export const lockCorporationResourceRolesInSqlTransaction = (
  transaction: postgres.TransactionSql,
  requests: readonly CorporationResourceRoleRequest[],
  now = new Date(),
): Promise<readonly CorporationResourceRoleResult[]> =>
  evaluateCorporationResourceRolesBatch(db, requests, now, true, transaction)

export const evaluateCorporationResourceRolesWithSqlConnection = (
  connection: postgres.Sql | postgres.TransactionSql,
  requests: readonly CorporationResourceRoleRequest[],
  now = new Date(),
): Promise<readonly CorporationResourceRoleResult[]> =>
  evaluateCorporationResourceRolesBatch(db, requests, now, false, connection)

interface CorporationResourceSourceRow {
  readonly sourceId: string
  readonly corporationLifecycleId: string
  readonly organizationVersion: number
  readonly sourceUserId: string
  readonly characterId: number
  readonly registeredCharacterId: number | null
  readonly corporationId: number
  readonly characterLifecycleId: string
  readonly affiliationPeriodRevision: string | null
  readonly authorizationGeneration: number
  readonly scopes: readonly string[]
}

const isCorporationResourceSourceCurrent = (
  candidate: CorporationResourceAuthorityCandidate,
  row: CorporationResourceSourceRow | undefined,
): row is CorporationResourceSourceRow =>
  row !== undefined &&
  !(
    row.corporationLifecycleId !== candidate.corporationLifecycleId ||
    (candidate.organizationVersion !== null &&
      Number(row.organizationVersion) !== candidate.organizationVersion) ||
    Number(row.characterId) !== candidate.characterId ||
    Number(row.registeredCharacterId) !== candidate.characterId ||
    Number(row.corporationId) !== candidate.corporationId ||
    row.characterLifecycleId !== candidate.characterLifecycleId ||
    Number(row.authorizationGeneration) !== candidate.authorizationGeneration
  )

const matchCorporationResourceSource = (
  candidate: CorporationResourceAuthorityCandidate,
  row: CorporationResourceSourceRow | undefined,
): CorporationRoleSourceBinding | null => {
  if (!isCorporationResourceSourceCurrent(candidate, row) || !row.affiliationPeriodRevision)
    return null
  return {
    affiliationPeriodRevision: row.affiliationPeriodRevision,
    authorityCorporationId: candidate.corporationId,
    authorizationGeneration: candidate.authorizationGeneration,
    characterId: candidate.characterId,
    organizationVersion: Number(row.organizationVersion),
    subjectLifecycleId: candidate.characterLifecycleId,
    userId: row.sourceUserId,
  }
}

const loadCorporationResourceSources = async (
  connection: postgres.Sql | postgres.TransactionSql,
  candidates: readonly CorporationResourceAuthorityCandidate[],
  lock: boolean,
): Promise<readonly CorporationResourceSourceRow[]> => {
  const lifecycles = [...new Set(candidates.map((candidate) => candidate.corporationLifecycleId))]
  const lockClause = lock
    ? connection`for share of source, lifecycle, character, token`
    : connection``
  return connection<CorporationResourceSourceRow[]>`
    select source.source_id as "sourceId", lifecycle.subject_lifecycle_id as "corporationLifecycleId",
      source.organization_version::integer as "organizationVersion",
      source.source_user_id as "sourceUserId",
      source.evidence_character_id::bigint as "characterId",
      source.character_id::bigint as "registeredCharacterId",
      source.corporation_id::bigint as "corporationId",
      source.source_subject_lifecycle_id as "characterLifecycleId",
      source.affiliation_period_revision as "affiliationPeriodRevision",
      source.authorization_generation as "authorizationGeneration",
      token.scopes as "scopes"
    from platform_subject_lifecycles lifecycle
    join organization_corporation_sources source on source.source_id = lifecycle.corporation_source_id
    join deployment_settings settings on settings.id = source.deployment_id
      and settings.organization_version = source.organization_version
    join characters character on character.character_id = source.evidence_character_id
      and character.user_id = source.source_user_id
      and character.corporation_id = source.corporation_id
      and (source.affiliation_period_revision is null
        or character.affiliation_period_revision = source.affiliation_period_revision)
    join eve_tokens token on token.character_id = character.character_id
      and token.token_version = source.authorization_generation
      and token.scopes @> jsonb_build_array(source.required_scope)
    where lifecycle.subject_kind = 'corporation'
      and lifecycle.subject_lifecycle_id in ${connection(lifecycles)}
      and source.deployment_id = 1 and source.revoked_at is null and source.invalidated_at is null
    order by lifecycle.subject_lifecycle_id
    ${lockClause}
  `
}

const toCorporationResourceRoleRequest = (
  candidate: CorporationResourceAuthorityCandidate,
  row: CorporationResourceSourceRow | undefined,
): CorporationResourceRoleRequest | null => {
  const binding = matchCorporationResourceSource(candidate, row)
  if (
    !binding ||
    !row ||
    candidate.predicates.length === 0 ||
    candidate.requiredScopes.some((scope) => !row.scopes.includes(scope))
  ) {
    return null
  }
  return {
    binding,
    corporationLifecycleId: candidate.corporationLifecycleId,
    predicates: candidate.predicates,
    requiredScopes: candidate.requiredScopes,
    sourceId: row.sourceId,
  }
}

const classifyCorporationResourceAuthority = (
  candidate: CorporationResourceAuthorityCandidate,
  row: CorporationResourceSourceRow | undefined,
  evidence: CorporationResourceRoleResult | undefined,
): CorporationResourceAuthorityVerdict => {
  if (!isCorporationResourceSourceCurrent(candidate, row)) {
    return {
      outcome: 'source-invalid',
      sourceId: null,
      roleRevision: null,
      validUntil: null,
      sourceBinding: null,
    }
  }
  const sourceBinding: CorporationResourceSourceCorrelation = {
    organizationVersion: Number(row.organizationVersion),
    characterId: candidate.characterId,
    characterLifecycleId: candidate.characterLifecycleId,
    affiliationPeriodRevision: row.affiliationPeriodRevision,
    corporationId: candidate.corporationId,
    authorizationGeneration: candidate.authorizationGeneration,
  }
  const missingScope = candidate.requiredScopes.find((scope) => !row.scopes.includes(scope))
  if (missingScope) {
    return {
      outcome: 'scope-missing',
      sourceId: row.sourceId,
      roleRevision: null,
      validUntil: null,
      missingScope,
      sourceBinding,
    }
  }
  if (candidate.predicates.length === 0) {
    return {
      outcome: 'satisfied',
      sourceId: row.sourceId,
      roleRevision: null,
      validUntil: null,
      sourceBinding,
    }
  }
  if (!row.affiliationPeriodRevision) {
    return {
      outcome: 'role-unavailable',
      sourceId: row.sourceId,
      roleRevision: null,
      validUntil: null,
      sourceBinding,
    }
  }
  if (evidence?.outcome === 'satisfied') {
    return {
      outcome: 'satisfied',
      sourceId: row.sourceId,
      roleRevision: evidence.revision,
      validUntil: evidence.freshUntil,
      sourceBinding,
    }
  }
  return {
    outcome: evidence?.outcome === 'unsatisfied' ? 'role-unsatisfied' : 'role-unavailable',
    sourceId: row.sourceId,
    roleRevision: evidence?.revision ?? null,
    validUntil: evidence?.freshUntil ?? null,
    sourceBinding,
  }
}

const evaluateCorporationResourceAuthorityBatch = async (
  connection: postgres.Sql | postgres.TransactionSql,
  candidates: readonly CorporationResourceAuthorityCandidate[],
  now: Date,
  transaction?: postgres.TransactionSql,
): Promise<readonly CorporationResourceAuthorityVerdict[]> => {
  if (
    candidates.length > maximumRoleBatchSize ||
    candidates.some(
      (candidate) =>
        candidate.requiredScopes.length > maximumRoleRequirements ||
        candidate.predicates.length > maximumRoleRequirements,
    )
  ) {
    throw new RangeError('Corporation authority batch exceeds reviewed bounds')
  }
  if (candidates.length === 0) return []
  const rows = await loadCorporationResourceSources(
    connection,
    candidates,
    transaction !== undefined,
  )
  const byLifecycle = new Map(rows.map((row) => [row.corporationLifecycleId, row]))
  const matched = candidates.flatMap((candidate, index) => {
    const request = toCorporationResourceRoleRequest(
      candidate,
      byLifecycle.get(candidate.corporationLifecycleId),
    )
    return request ? [{ index, request }] : []
  })
  const evidenceRequests = matched.map(({ request }) => request)
  let evaluated: readonly CorporationResourceRoleResult[] = []
  if (evidenceRequests.length > 0) {
    evaluated = transaction
      ? await lockCorporationResourceRolesInSqlTransaction(transaction, evidenceRequests, now)
      : await evaluateCorporationResourceRolesWithSqlConnection(connection, evidenceRequests, now)
  }
  const byIndex = new Map(matched.map(({ index }, offset) => [index, evaluated[offset]]))
  return candidates.map((candidate, index) => {
    const row = byLifecycle.get(candidate.corporationLifecycleId)
    return classifyCorporationResourceAuthority(candidate, row, byIndex.get(index))
  })
}

export const evaluateCorporationResourceAuthority = (
  connection: postgres.Sql | postgres.TransactionSql,
  candidates: readonly CorporationResourceAuthorityCandidate[],
  now = new Date(),
): Promise<readonly CorporationResourceAuthorityVerdict[]> =>
  evaluateCorporationResourceAuthorityBatch(connection, candidates, now)

export const lockCorporationResourceAuthorityInTransaction = (
  transaction: postgres.TransactionSql,
  candidates: readonly CorporationResourceAuthorityCandidate[],
  now = new Date(),
): Promise<readonly CorporationResourceAuthorityVerdict[]> =>
  evaluateCorporationResourceAuthorityBatch(transaction, candidates, now, transaction)

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
