import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  corporationRoleObservationRequiredScope,
  evaluateCorporationRoleEvidence,
  type CorporationRolePredicateEvaluation,
} from '../characters/corporation-role-evidence.js'
import { type ReviewedCorporationRolePredicate } from '../characters/corporation-role-canonical.js'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAccountCompliance,
  organizationDerivedAuthoritySources,
  organizationRoleGrants,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { resolveAffiliationFreshness } from './affiliation-freshness.js'
import {
  loadCurrentAllianceExecutor,
  type CurrentAllianceExecutor,
} from './alliance-executor-evidence.js'
import { loadEffectiveOrganizationAuthority } from './effective-authority.js'
import { hasActiveOrganizationMemberBlock } from './member-block.js'
import {
  evaluateRuleEligibility,
  isOrganizationRuleRolePredicate,
  type RuleCondition,
  type RuleEligibility,
  type RuleEvidenceSource,
} from './rule-policy.js'

type Database = DatabaseTransaction | typeof db
const persistedScopesSchema = z.array(z.string())

interface RuleOrganization {
  readonly organizationType: 'corporation' | 'alliance'
  readonly organizationId: number
  readonly organizationVersion: number
}

const loadCurrentOrganization = async (database: Database, organizationVersion: number) => {
  const [organization] = await database
    .select({
      organizationType: deploymentSettings.organizationType,
      organizationId: deploymentSettings.organizationId,
      organizationVersion: deploymentSettings.organizationVersion,
    })
    .from(deploymentSettings)
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
  if (!organization?.organizationType || !organization.organizationId) {
    return null
  }
  return {
    organizationId: organization.organizationId,
    organizationType: organization.organizationType,
    organizationVersion: organization.organizationVersion,
  }
}

const loadAccountCompliance = async (
  database: Database,
  organizationVersion: number,
  userId: string,
) => {
  const [account] = await database
    .select({
      accessValidUntil: organizationAccountCompliance.accessValidUntil,
      authoritative: organizationAccountCompliance.authoritative,
      evidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      reviewDeadline: organizationAccountCompliance.reviewDeadline,
      state: organizationAccountCompliance.state,
    })
    .from(organizationAccountCompliance)
    .where(
      and(
        eq(organizationAccountCompliance.deploymentId, 1),
        eq(organizationAccountCompliance.organizationVersion, organizationVersion),
        eq(organizationAccountCompliance.userId, userId),
      ),
    )
  return account ?? null
}

const loadExplicitDirectorSource = async (
  database: Database,
  organizationVersion: number,
  userId: string,
  accessValidUntil: Date,
): Promise<RuleEvidenceSource | null> => {
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
  return grant
    ? {
        binding: null,
        bindingCurrent: true,
        complete: true,
        freshUntil: accessValidUntil,
        kind: 'explicit-director',
        predicate: null,
        roleRevision: null,
        sourceId: grant.grantId,
        status: 'fresh',
      }
    : null
}

const loadDerivedRoleRows = (database: Database, organizationVersion: number, userId: string) =>
  database
    .select({
      authorityCorporationId: organizationDerivedAuthoritySources.authorityCorporationId,
      affiliationPeriodRevision: organizationDerivedAuthoritySources.affiliationPeriodRevision,
      authorizationGeneration: organizationDerivedAuthoritySources.authorizationGeneration,
      characterId: organizationDerivedAuthoritySources.characterId,
      freshUntil: organizationDerivedAuthoritySources.freshUntil,
      roleRevision: organizationDerivedAuthoritySources.roleEvidenceRevision,
      sourceId: organizationDerivedAuthoritySources.sourceId,
      sourceSubjectLifecycleId: organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
    })
    .from(organizationDerivedAuthoritySources)
    .where(
      and(
        eq(organizationDerivedAuthoritySources.deploymentId, 1),
        eq(organizationDerivedAuthoritySources.organizationVersion, organizationVersion),
        eq(organizationDerivedAuthoritySources.userId, userId),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )

type DerivedRoleRow = Awaited<ReturnType<typeof loadDerivedRoleRows>>[number]

const isCurrentDerivedRoleEvidence = (
  evaluation: CorporationRolePredicateEvaluation | null,
  roleRevision: DerivedRoleRow['roleRevision'],
) =>
  Boolean(
    evaluation?.bindingCurrent &&
    evaluation.outcome === 'satisfied' &&
    evaluation.evidence?.state === 'fresh' &&
    evaluation.evidence.roleRevision === roleRevision,
  )

const evaluateDerivedRoleSource = async (
  database: Database,
  candidate: DerivedRoleRow,
  input: {
    organization: RuleOrganization
    executor: CurrentAllianceExecutor | null
    userId: string
    now: Date
    accessValidUntil: Date
    supported: boolean
  },
): Promise<RuleEvidenceSource> => {
  const executorCurrent =
    input.organization.organizationType === 'corporation' ||
    candidate.authorityCorporationId === input.executor?.corporationId
  const evaluation =
    input.supported && executorCurrent && candidate.affiliationPeriodRevision
      ? await evaluateCorporationRoleEvidence(database, {
          binding: {
            affiliationPeriodRevision: candidate.affiliationPeriodRevision,
            authorityCorporationId: candidate.authorityCorporationId,
            authorizationGeneration: candidate.authorizationGeneration,
            characterId: candidate.characterId,
            organizationVersion: input.organization.organizationVersion,
            subjectLifecycleId: candidate.sourceSubjectLifecycleId,
            userId: input.userId,
          },
          requiredScope: corporationRoleObservationRequiredScope,
          predicate: 'director',
          now: input.now,
        })
      : null
  const currentRole = isCurrentDerivedRoleEvidence(evaluation, candidate.roleRevision)
  let status: RuleEvidenceSource['status'] =
    evaluation?.evidence?.state === 'degraded' ? 'degraded' : 'invalid'
  if (currentRole) status = 'fresh'
  const executor = input.organization.organizationType === 'alliance' ? input.executor : null
  const freshUntil = new Date(
    Math.min(
      candidate.freshUntil.getTime(),
      input.accessValidUntil.getTime(),
      executor?.freshUntil.getTime() ?? Number.POSITIVE_INFINITY,
    ),
  )
  return {
    binding: candidate.affiliationPeriodRevision
      ? {
          affiliationPeriodRevision: candidate.affiliationPeriodRevision,
          authorityCorporationId: candidate.authorityCorporationId,
          authorizationGeneration: candidate.authorizationGeneration,
          executorFreshUntil: executor?.freshUntil ?? null,
          executorRevision: executor?.revision ?? null,
          subjectLifecycleId: candidate.sourceSubjectLifecycleId,
        }
      : null,
    bindingCurrent: currentRole,
    complete: currentRole,
    freshUntil,
    kind: 'derived-director',
    predicate: null,
    roleRevision: currentRole ? candidate.roleRevision : null,
    sourceId: candidate.sourceId,
    status,
  }
}

const loadDirectorSources = async (
  database: Database,
  organization: RuleOrganization,
  executor: CurrentAllianceExecutor | null,
  userId: string,
  now: Date,
  accessValidUntil: Date,
): Promise<RuleEvidenceSource[]> => {
  const authority = await loadEffectiveOrganizationAuthority(
    database,
    organization.organizationVersion,
    userId,
    'mutate',
    now,
  )
  const explicit = authority.explicitDirector
    ? await loadExplicitDirectorSource(
        database,
        organization.organizationVersion,
        userId,
        accessValidUntil,
      )
    : null
  const rows = await loadDerivedRoleRows(database, organization.organizationVersion, userId)
  const derived = await Promise.all(
    rows.map((candidate) =>
      evaluateDerivedRoleSource(database, candidate, {
        organization,
        executor,
        userId,
        now,
        accessValidUntil,
        supported: authority.derivedSources.some(
          (source) => source.sourceId === candidate.sourceId && source.state === 'fresh',
        ),
      }),
    ),
  )
  return explicit ? [explicit, ...derived] : derived
}

const loadRoleCandidates = (
  database: Database,
  userId: string,
  corporationId: number,
  afterCharacterId: number | null,
) =>
  database
    .select({
      affiliationCheckedAt: characters.affiliationCheckedAt,
      affiliationPeriodRevision: characters.affiliationPeriodRevision,
      affiliationResolutionState: characters.affiliationResolutionState,
      allianceId: characters.allianceId,
      authorizationGeneration: eveTokens.tokenVersion,
      characterId: characters.characterId,
      corporationId: characters.corporationId,
      nextAffiliationCheck: characters.nextAffiliationCheck,
      scopes: eveTokens.scopes,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
    })
    .from(characters)
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .where(
      and(
        eq(characters.userId, userId),
        eq(characters.corporationId, corporationId),
        afterCharacterId === null ? undefined : gt(characters.characterId, afterCharacterId),
      ),
    )
    .orderBy(asc(characters.characterId))
    .limit(100)

type RoleCandidate = Awaited<ReturnType<typeof loadRoleCandidates>>[number]

const isRoleCandidateCurrent = (
  candidate: RoleCandidate,
  organization: RuleOrganization,
  now: Date,
) => {
  const scopes = persistedScopesSchema.safeParse(candidate.scopes)
  return (
    resolveAffiliationFreshness(candidate, now) === 'fresh' &&
    (organization.organizationType === 'corporation' ||
      candidate.allianceId === organization.organizationId) &&
    scopes.success &&
    scopes.data.includes(corporationRoleObservationRequiredScope)
  )
}

const toRoleSource = (
  candidate: RoleCandidate,
  input: {
    readonly corporationId: number
    readonly predicate: ReviewedCorporationRolePredicate
    readonly executor: CurrentAllianceExecutor | null
    readonly accessValidUntil: Date
    readonly bindingCurrent: boolean
  },
  evaluation: CorporationRolePredicateEvaluation | null,
): RuleEvidenceSource => {
  const evidence = evaluation?.evidence
  const freshUntil =
    evidence?.freshUntil && candidate.nextAffiliationCheck
      ? new Date(
          Math.min(
            evidence.freshUntil.getTime(),
            candidate.nextAffiliationCheck.getTime(),
            input.accessValidUntil.getTime(),
            input.executor?.freshUntil.getTime() ?? Number.POSITIVE_INFINITY,
          ),
        )
      : null
  const state = evidence?.state
  const status: RuleEvidenceSource['status'] =
    state === 'pending' ? 'unavailable' : (state ?? 'unavailable')
  return {
    binding: {
      affiliationPeriodRevision: candidate.affiliationPeriodRevision,
      authorityCorporationId: input.corporationId,
      authorizationGeneration: candidate.authorizationGeneration,
      executorFreshUntil: input.executor?.freshUntil ?? null,
      executorRevision: input.executor?.revision ?? null,
      subjectLifecycleId: candidate.subjectLifecycleId,
    },
    bindingCurrent: input.bindingCurrent && Boolean(evaluation?.bindingCurrent),
    complete: evaluation?.outcome === 'satisfied',
    freshUntil,
    kind: 'corporation-role',
    predicate: input.predicate,
    roleRevision: evidence?.roleRevision ?? null,
    sourceId: candidate.subjectLifecycleId,
    status,
  }
}

const evaluateRoleCandidate = async (
  database: Database,
  candidate: RoleCandidate,
  input: {
    readonly corporationId: number
    readonly predicate: ReviewedCorporationRolePredicate
    readonly executor: CurrentAllianceExecutor | null
    readonly accessValidUntil: Date
    readonly organization: RuleOrganization
    readonly userId: string
    readonly now: Date
  },
): Promise<RuleEvidenceSource> => {
  const bindingCurrent = isRoleCandidateCurrent(candidate, input.organization, input.now)
  const evaluation = bindingCurrent
    ? await evaluateCorporationRoleEvidence(database, {
        binding: {
          affiliationPeriodRevision: candidate.affiliationPeriodRevision,
          authorityCorporationId: input.corporationId,
          authorizationGeneration: candidate.authorizationGeneration,
          characterId: candidate.characterId,
          organizationVersion: input.organization.organizationVersion,
          subjectLifecycleId: candidate.subjectLifecycleId,
          userId: input.userId,
        },
        requiredScope: corporationRoleObservationRequiredScope,
        predicate: input.predicate,
        now: input.now,
      })
    : null
  return toRoleSource(candidate, { ...input, bindingCurrent }, evaluation)
}

const loadRoleSources = async (
  database: Database,
  organization: RuleOrganization,
  executor: CurrentAllianceExecutor | null,
  userId: string,
  predicate: ReviewedCorporationRolePredicate,
  now: Date,
  accessValidUntil: Date,
): Promise<RuleEvidenceSource[]> => {
  const corporationId =
    organization.organizationType === 'alliance'
      ? executor?.corporationId
      : organization.organizationId
  if (!corporationId) return []
  const sources: RuleEvidenceSource[] = []
  let afterCharacterId: number | null = null
  /* oxlint-disable no-await-in-loop -- Each role page advances the character cursor. */
  while (true) {
    const candidates = await loadRoleCandidates(database, userId, corporationId, afterCharacterId)
    sources.push(
      ...(await Promise.all(
        candidates.map((candidate) =>
          evaluateRoleCandidate(database, candidate, {
            corporationId,
            predicate,
            executor,
            accessValidUntil,
            organization,
            userId,
            now,
          }),
        ),
      )),
    )
    if (candidates.length < 100) break
    const last = candidates.at(-1)
    if (!last) break
    afterCharacterId = last.characterId
  }
  /* oxlint-enable no-await-in-loop */
  return sources
}

type CurrentAccount = NonNullable<Awaited<ReturnType<typeof loadAccountCompliance>>> & {
  readonly accessValidUntil: Date
}

const isAdmittedRuleAccount = (
  account: Awaited<ReturnType<typeof loadAccountCompliance>>,
  now: Date,
): account is CurrentAccount =>
  Boolean(
    account?.authoritative &&
    account.accessValidUntil &&
    account.accessValidUntil > now &&
    account.evidenceFreshness === 'fresh' &&
    (account.state === 'compliant' ||
      (account.state === 'review_required' &&
        account.reviewDeadline &&
        account.reviewDeadline > now)),
  )

const loadConditionSources = async (
  database: Database,
  input: {
    readonly condition: RuleCondition
    readonly organization: RuleOrganization
    readonly executor: CurrentAllianceExecutor | null
    readonly userId: string
    readonly now: Date
    readonly accessValidUntil: Date
  },
): Promise<RuleEvidenceSource[]> => {
  if (input.condition.kind === 'registration-compliant') {
    return [
      {
        binding: null,
        bindingCurrent: true,
        complete: true,
        freshUntil: input.accessValidUntil,
        kind: 'registration',
        predicate: null,
        roleRevision: null,
        sourceId: input.userId,
        status: 'fresh',
      },
    ]
  }
  if (input.condition.kind === 'director-audience') {
    return loadDirectorSources(
      database,
      input.organization,
      input.executor,
      input.userId,
      input.now,
      input.accessValidUntil,
    )
  }
  if (!isOrganizationRuleRolePredicate(input.condition.predicate)) return []
  return loadRoleSources(
    database,
    input.organization,
    input.executor,
    input.userId,
    input.condition.predicate,
    input.now,
    input.accessValidUntil,
  )
}

export const evaluateOrganizationRuleAccount = async (
  database: Database,
  input: {
    readonly organizationVersion: number
    readonly userId: string
    readonly condition: RuleCondition
    readonly now?: Date
  },
): Promise<RuleEligibility> => {
  const now = input.now ?? new Date()
  const organization = await loadCurrentOrganization(database, input.organizationVersion)
  if (!organization) {
    return { outcome: 'ineligible', contributors: [] }
  }
  const account = await loadAccountCompliance(database, input.organizationVersion, input.userId)
  const blocked = await hasActiveOrganizationMemberBlock(
    database,
    input.organizationVersion,
    input.userId,
  )
  if (!isAdmittedRuleAccount(account, now) || blocked) {
    return { outcome: 'ineligible', contributors: [] }
  }
  const executor =
    organization.organizationType === 'alliance'
      ? await loadCurrentAllianceExecutor(database, input.organizationVersion, now)
      : null
  const sources = await loadConditionSources(database, {
    condition: input.condition,
    organization,
    executor,
    userId: input.userId,
    now,
    accessValidUntil: account.accessValidUntil,
  })
  const needsExecutor =
    organization.organizationType === 'alliance' &&
    input.condition.kind !== 'registration-compliant'
  return evaluateRuleEligibility({
    admitted: true,
    blocked,
    compliant: account.state === 'compliant',
    condition: input.condition,
    evidenceUnavailable: needsExecutor && !executor,
    now,
    sources,
  })
}
