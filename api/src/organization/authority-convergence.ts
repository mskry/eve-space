import { and, eq, inArray, isNull, ne, or, sql, type SQLWrapper } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationAuthorityEvidence,
  organizationCorporationSources,
  organizationDerivedAuthoritySources,
  type OrganizationAuthorityEvidenceStatus,
  type OrganizationAuthorityInvalidationOutcome,
} from '../db/schema.js'
import { appendOrganizationAuditEvents } from './audit.js'
import { convergeCurrentManagedMemberLifecyclesInTransaction } from './managed-member-lifecycle.js'

export async function invalidateCharacterAuthoritySourcesInTransaction(
  transaction: DatabaseTransaction,
  input: {
    characterId: number
    outcome: OrganizationAuthorityInvalidationOutcome
    now?: Date
    expected?: {
      organizationVersion: number
      sourceSubjectLifecycleId: string
      authorizationGeneration: number
    }
  },
) {
  const now = input.now ?? new Date()
  const [settings] = await transaction
    .select({ policyVersion: deploymentSettings.registrationPolicyVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!settings) {
    return
  }

  const ownerSources = await transaction
    .update(organizationAuthorityEvidence)
    .set({
      status: 'invalid',
      ...(input.outcome === 'not-director' ? { directorRolePresent: false } : {}),
      graceUntil: null,
      failureClass: `strict:${input.outcome}`,
      invalidatedAt: now,
      invalidationOutcome: input.outcome,
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationAuthorityEvidence.characterId, input.characterId),
        isNull(organizationAuthorityEvidence.invalidatedAt),
        input.expected
          ? and(
              eq(
                organizationAuthorityEvidence.organizationVersion,
                input.expected.organizationVersion,
              ),
              eq(
                organizationAuthorityEvidence.sourceSubjectLifecycleId,
                input.expected.sourceSubjectLifecycleId,
              ),
              eq(
                organizationAuthorityEvidence.authorizationGeneration,
                input.expected.authorizationGeneration,
              ),
            )
          : undefined,
      ),
    )
    .returning({
      evidenceId: organizationAuthorityEvidence.evidenceId,
      grantId: organizationAuthorityEvidence.grantId,
      organizationVersion: organizationAuthorityEvidence.organizationVersion,
      userId: organizationAuthorityEvidence.userId,
    })
  const derivedSources = await transaction
    .update(organizationDerivedAuthoritySources)
    .set({
      status: 'invalid',
      ...(input.outcome === 'not-director' ? { directorRolePresent: false } : {}),
      graceUntil: null,
      failureClass: `strict:${input.outcome}`,
      invalidatedAt: now,
      invalidationOutcome: input.outcome,
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationDerivedAuthoritySources.characterId, input.characterId),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
        input.expected
          ? and(
              eq(
                organizationDerivedAuthoritySources.organizationVersion,
                input.expected.organizationVersion,
              ),
              eq(
                organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
                input.expected.sourceSubjectLifecycleId,
              ),
              eq(
                organizationDerivedAuthoritySources.authorizationGeneration,
                input.expected.authorizationGeneration,
              ),
            )
          : undefined,
      ),
    )
    .returning({
      organizationVersion: organizationDerivedAuthoritySources.organizationVersion,
      sourceId: organizationDerivedAuthoritySources.sourceId,
      userId: organizationDerivedAuthoritySources.userId,
    })

  const corporationSources = await transaction
    .update(organizationCorporationSources)
    .set({
      status: 'invalid',
      ...(input.outcome === 'not-director' ? { directorRolePresent: false } : {}),
      graceUntil: null,
      failureClass: `strict:${input.outcome}`,
      invalidatedAt: now,
      invalidationOutcome: input.outcome,
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationCorporationSources.evidenceCharacterId, input.characterId),
        ne(organizationCorporationSources.status, 'invalid'),
        isNull(organizationCorporationSources.revokedAt),
        input.expected
          ? and(
              eq(
                organizationCorporationSources.organizationVersion,
                input.expected.organizationVersion,
              ),
              eq(
                organizationCorporationSources.sourceSubjectLifecycleId,
                input.expected.sourceSubjectLifecycleId,
              ),
              eq(
                organizationCorporationSources.authorizationGeneration,
                input.expected.authorizationGeneration,
              ),
            )
          : undefined,
      ),
    )
    .returning({
      organizationVersion: organizationCorporationSources.organizationVersion,
      sourceId: organizationCorporationSources.sourceId,
      userId: organizationCorporationSources.sourceUserId,
    })

  await appendOrganizationAuditEvents(transaction, [
    ...ownerSources.map((source) => ({
      actorId: null,
      actorType: 'system' as const,
      deploymentId: 1 as const,
      eventType: 'authority-source.invalidated' as const,
      occurredAt: now,
      organizationVersion: source.organizationVersion,
      outcome: 'revoked' as const,
      policyVersion: settings.policyVersion,
      reason: `Organization-owner source invalidated: ${input.outcome}.`,
      subjectId: source.evidenceId,
      subjectType: 'authority_source' as const,
    })),
    ...derivedSources.map((source) => ({
      actorId: null,
      actorType: 'system' as const,
      deploymentId: 1 as const,
      eventType: 'authority-source.invalidated' as const,
      occurredAt: now,
      organizationVersion: source.organizationVersion,
      outcome: 'revoked' as const,
      policyVersion: settings.policyVersion,
      reason: `Derived Director source invalidated: ${input.outcome}.`,
      subjectId: source.sourceId,
      subjectType: 'authority_source' as const,
    })),
    ...corporationSources.map((source) => ({
      actorId: null,
      actorType: 'system' as const,
      deploymentId: 1 as const,
      eventType: 'authority-source.invalidated' as const,
      occurredAt: now,
      organizationVersion: source.organizationVersion,
      outcome: 'revoked' as const,
      policyVersion: settings.policyVersion,
      reason: `Corporation source invalidated: ${input.outcome}.`,
      subjectId: source.sourceId,
      subjectType: 'corporation_source' as const,
    })),
  ])
}

export async function advanceCharacterAuthorityAuthorizationGenerationInTransaction(
  transaction: DatabaseTransaction,
  input: { characterId: number; authorizationGeneration: number; now?: Date },
) {
  const updatedAt = input.now ?? new Date()
  await transaction
    .update(organizationAuthorityEvidence)
    .set({ authorizationGeneration: input.authorizationGeneration, updatedAt })
    .where(
      and(
        eq(organizationAuthorityEvidence.characterId, input.characterId),
        isNull(organizationAuthorityEvidence.invalidatedAt),
      ),
    )
  await transaction
    .update(organizationDerivedAuthoritySources)
    .set({ authorizationGeneration: input.authorizationGeneration, updatedAt })
    .where(
      and(
        eq(organizationDerivedAuthoritySources.characterId, input.characterId),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
  await transaction
    .update(organizationCorporationSources)
    .set({ authorizationGeneration: input.authorizationGeneration, updatedAt })
    .where(
      and(
        eq(organizationCorporationSources.evidenceCharacterId, input.characterId),
        isNull(organizationCorporationSources.revokedAt),
        ne(organizationCorporationSources.status, 'invalid'),
      ),
    )
}

async function convergeAffiliationAuthoritySourcesInTransaction(
  transaction: DatabaseTransaction,
  input: { userIds: readonly string[]; now?: Date },
) {
  if (input.userIds.length === 0) {
    return
  }
  const mismatchedDerived = await transaction
    .select({ characterId: organizationDerivedAuthoritySources.characterId })
    .from(organizationDerivedAuthoritySources)
    .innerJoin(
      characters,
      eq(characters.characterId, organizationDerivedAuthoritySources.characterId),
    )
    .where(
      and(
        inArray(organizationDerivedAuthoritySources.userId, [...input.userIds]),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
        or(
          ne(organizationDerivedAuthoritySources.observedCorporationId, characters.corporationId),
          sql`${organizationDerivedAuthoritySources.observedAllianceId} is distinct from ${characters.allianceId}`,
        ),
      ),
    )
  const mismatchedOwner = await transaction
    .select({ characterId: organizationAuthorityEvidence.characterId })
    .from(organizationAuthorityEvidence)
    .innerJoin(characters, eq(characters.characterId, organizationAuthorityEvidence.characterId))
    .where(
      and(
        inArray(organizationAuthorityEvidence.userId, [...input.userIds]),
        isNull(organizationAuthorityEvidence.invalidatedAt),
        or(
          ne(organizationAuthorityEvidence.observedCorporationId, characters.corporationId),
          sql`${organizationAuthorityEvidence.observedAllianceId} is distinct from ${characters.allianceId}`,
        ),
      ),
    )
  const mismatchedCorporation = await transaction
    .select({ characterId: organizationCorporationSources.evidenceCharacterId })
    .from(organizationCorporationSources)
    .innerJoin(
      characters,
      eq(characters.characterId, organizationCorporationSources.evidenceCharacterId),
    )
    .where(
      and(
        inArray(organizationCorporationSources.sourceUserId, [...input.userIds]),
        isNull(organizationCorporationSources.revokedAt),
        or(
          ne(organizationCorporationSources.observedCorporationId, characters.corporationId),
          sql`${organizationCorporationSources.observedAllianceId} is distinct from ${characters.allianceId}`,
        ),
      ),
    )
  const characterIds = new Set(
    [...mismatchedDerived, ...mismatchedOwner, ...mismatchedCorporation].map(
      ({ characterId }) => characterId,
    ),
  )
  for (const characterId of characterIds) {
    // oxlint-disable-next-line no-await-in-loop
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId,
      now: input.now,
      outcome: 'affiliation-changed',
    })
  }
}

export async function convergeObservedAffiliationInTransaction(
  transaction: DatabaseTransaction,
  userIds: readonly string[],
  observedAt: Date,
) {
  await convergeCurrentManagedMemberLifecyclesInTransaction(transaction, {
    now: observedAt,
    userIds,
  })
  await convergeAffiliationAuthoritySourcesInTransaction(transaction, {
    now: observedAt,
    userIds,
  })
}

export async function invalidateOrganizationAuthoritySourcesInTransaction(
  transaction: DatabaseTransaction,
  input: { organizationVersion: number; policyVersion: number; now?: Date },
) {
  const now = input.now ?? new Date()
  const invalidation = {
    failureClass: 'strict:organization-replaced',
    graceUntil: null,
    invalidatedAt: now,
    invalidationOutcome: 'organization-replaced' as const,
    status: 'invalid' as const,
    updatedAt: now,
  }
  const ownerSources = await transaction
    .update(organizationAuthorityEvidence)
    .set(invalidation)
    .where(
      and(
        eq(organizationAuthorityEvidence.organizationVersion, input.organizationVersion),
        isNull(organizationAuthorityEvidence.invalidatedAt),
      ),
    )
    .returning({
      organizationVersion: organizationAuthorityEvidence.organizationVersion,
      sourceId: organizationAuthorityEvidence.evidenceId,
      subjectType: sql<'authority_source'>`'authority_source'`,
      userId: organizationAuthorityEvidence.userId,
    })
  const derivedSources = await transaction
    .update(organizationDerivedAuthoritySources)
    .set(invalidation)
    .where(
      and(
        eq(organizationDerivedAuthoritySources.organizationVersion, input.organizationVersion),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
    .returning({
      organizationVersion: organizationDerivedAuthoritySources.organizationVersion,
      sourceId: organizationDerivedAuthoritySources.sourceId,
      subjectType: sql<'authority_source'>`'authority_source'`,
      userId: organizationDerivedAuthoritySources.userId,
    })
  const corporationSources = await transaction
    .update(organizationCorporationSources)
    .set(invalidation)
    .where(
      and(
        eq(organizationCorporationSources.organizationVersion, input.organizationVersion),
        ne(organizationCorporationSources.status, 'invalid'),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
    .returning({
      organizationVersion: organizationCorporationSources.organizationVersion,
      sourceId: organizationCorporationSources.sourceId,
      subjectType: sql<'corporation_source'>`'corporation_source'`,
      userId: organizationCorporationSources.sourceUserId,
    })
  const invalidated = [...ownerSources, ...derivedSources, ...corporationSources]
  await appendOrganizationAuditEvents(
    transaction,
    invalidated.map((source) => ({
      actorId: null,
      actorType: 'system' as const,
      deploymentId: 1 as const,
      eventType: 'authority-source.invalidated' as const,
      occurredAt: now,
      organizationVersion: source.organizationVersion,
      outcome: 'revoked' as const,
      policyVersion: input.policyVersion,
      reason: 'Authority source invalidated because the managed organization changed.',
      subjectId: source.sourceId,
      subjectType: source.subjectType,
    })),
  )
}

export async function invalidateDerivedAuthorityPolicySourcesInTransaction(
  transaction: DatabaseTransaction,
  input: { organizationVersion: number; policyVersion: number; now?: Date },
) {
  const now = input.now ?? new Date()
  const sources = await transaction
    .update(organizationDerivedAuthoritySources)
    .set({
      failureClass: 'strict:policy-disabled',
      graceUntil: null,
      invalidatedAt: now,
      invalidationOutcome: 'policy-disabled',
      status: 'invalid',
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationDerivedAuthoritySources.organizationVersion, input.organizationVersion),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
    .returning({
      organizationVersion: organizationDerivedAuthoritySources.organizationVersion,
      sourceId: organizationDerivedAuthoritySources.sourceId,
      userId: organizationDerivedAuthoritySources.userId,
    })
  await appendOrganizationAuditEvents(
    transaction,
    sources.map((source) => ({
      actorId: null,
      actorType: 'system' as const,
      deploymentId: 1 as const,
      eventType: 'authority-source.invalidated' as const,
      occurredAt: now,
      organizationVersion: source.organizationVersion,
      outcome: 'revoked' as const,
      policyVersion: input.policyVersion,
      reason: 'Derived Director authority was disabled by organization policy.',
      subjectId: source.sourceId,
      subjectType: 'authority_source' as const,
    })),
  )
}

export async function reconcileAuthorityPolicyDeadlinesInTransaction(
  transaction: DatabaseTransaction,
  input: {
    organizationVersion: number
    policyVersion: number
    freshDurationSeconds: number
    staleGraceDurationSeconds: number
    now: Date
  },
) {
  const ownerSources = await clampOwnerDeadlines(transaction, input)
  const derivedSources = await clampDerivedDeadlines(transaction, input)
  const corporationSources = await clampCorporationSourceDeadlines(transaction, input)
  const invalidated = [...ownerSources, ...derivedSources, ...corporationSources].filter(
    (source) => source.invalidatedAt !== null,
  )
  await appendOrganizationAuditEvents(
    transaction,
    invalidated.map((source) => ({
      actorId: null,
      actorType: 'system' as const,
      deploymentId: 1 as const,
      eventType: 'authority-source.invalidated' as const,
      occurredAt: input.now,
      organizationVersion: input.organizationVersion,
      outcome: 'revoked' as const,
      policyVersion: input.policyVersion,
      reason: 'Authority evidence expired under the updated policy deadline.',
      subjectId: source.sourceId,
      subjectType: source.subjectType,
    })),
  )
}

type AuthorityDeadlineInput = Parameters<typeof reconcileAuthorityPolicyDeadlinesInTransaction>[1]

type AuthorityDeadlineColumns = {
  status: SQLWrapper
  observedAt: SQLWrapper
  freshUntil: SQLWrapper
  graceUntil: SQLWrapper
  invalidatedAt: SQLWrapper
  invalidationOutcome: SQLWrapper
  failureClass: SQLWrapper
}

function deadlineExpressions(columns: AuthorityDeadlineColumns, input: AuthorityDeadlineInput) {
  const {
    status,
    observedAt,
    freshUntil,
    graceUntil,
    invalidatedAt,
    invalidationOutcome,
    failureClass,
  } = columns
  const boundedFreshUntil = sql<Date>`least(${freshUntil}, ${observedAt} + ${input.freshDurationSeconds} * interval '1 second')`
  const boundedGraceUntil = sql<Date>`least(${graceUntil}, ${boundedFreshUntil} + ${input.staleGraceDurationSeconds} * interval '1 second')`
  const expired = sql`(
    (${status} = 'fresh' and ${boundedFreshUntil} <= ${input.now})
    or (${status} = 'degraded' and ${boundedGraceUntil} <= ${input.now})
  )`
  return {
    failureClass: sql<
      string | null
    >`case when ${expired} then 'strict:expired' else ${failureClass} end`,
    freshUntil: boundedFreshUntil,
    graceUntil: sql<Date | null>`case
      when ${expired} then null
      when ${status} = 'degraded' then ${boundedGraceUntil}
      else null
    end`,
    invalidatedAt: sql<Date | null>`case when ${expired} then ${input.now} else ${invalidatedAt} end`,
    invalidationOutcome: sql<OrganizationAuthorityInvalidationOutcome | null>`case when ${expired} then 'expired' else ${invalidationOutcome} end`,
    status: sql<OrganizationAuthorityEvidenceStatus>`case when ${expired} then 'invalid' else ${status} end`,
    updatedAt: input.now,
  }
}

async function clampOwnerDeadlines(
  transaction: DatabaseTransaction,
  input: AuthorityDeadlineInput,
) {
  return transaction
    .update(organizationAuthorityEvidence)
    .set(
      deadlineExpressions(
        {
          failureClass: organizationAuthorityEvidence.failureClass,
          freshUntil: organizationAuthorityEvidence.freshUntil,
          graceUntil: organizationAuthorityEvidence.graceUntil,
          invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
          invalidationOutcome: organizationAuthorityEvidence.invalidationOutcome,
          observedAt: organizationAuthorityEvidence.observedAt,
          status: organizationAuthorityEvidence.status,
        },
        input,
      ),
    )
    .where(
      and(
        eq(organizationAuthorityEvidence.organizationVersion, input.organizationVersion),
        isNull(organizationAuthorityEvidence.invalidatedAt),
      ),
    )
    .returning({
      invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      organizationVersion: organizationAuthorityEvidence.organizationVersion,
      sourceId: organizationAuthorityEvidence.evidenceId,
      subjectType: sql<'authority_source'>`'authority_source'`,
      userId: organizationAuthorityEvidence.userId,
    })
}

async function clampDerivedDeadlines(
  transaction: DatabaseTransaction,
  input: AuthorityDeadlineInput,
) {
  return transaction
    .update(organizationDerivedAuthoritySources)
    .set(
      deadlineExpressions(
        {
          failureClass: organizationDerivedAuthoritySources.failureClass,
          freshUntil: organizationDerivedAuthoritySources.freshUntil,
          graceUntil: organizationDerivedAuthoritySources.graceUntil,
          invalidatedAt: organizationDerivedAuthoritySources.invalidatedAt,
          invalidationOutcome: organizationDerivedAuthoritySources.invalidationOutcome,
          observedAt: organizationDerivedAuthoritySources.observedAt,
          status: organizationDerivedAuthoritySources.status,
        },
        input,
      ),
    )
    .where(
      and(
        eq(organizationDerivedAuthoritySources.organizationVersion, input.organizationVersion),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
    .returning({
      invalidatedAt: organizationDerivedAuthoritySources.invalidatedAt,
      organizationVersion: organizationDerivedAuthoritySources.organizationVersion,
      sourceId: organizationDerivedAuthoritySources.sourceId,
      subjectType: sql<'authority_source'>`'authority_source'`,
      userId: organizationDerivedAuthoritySources.userId,
    })
}

async function clampCorporationSourceDeadlines(
  transaction: DatabaseTransaction,
  input: AuthorityDeadlineInput,
) {
  return transaction
    .update(organizationCorporationSources)
    .set(
      deadlineExpressions(
        {
          failureClass: organizationCorporationSources.failureClass,
          freshUntil: organizationCorporationSources.freshUntil,
          graceUntil: organizationCorporationSources.graceUntil,
          invalidatedAt: organizationCorporationSources.invalidatedAt,
          invalidationOutcome: organizationCorporationSources.invalidationOutcome,
          observedAt: organizationCorporationSources.observedAt,
          status: organizationCorporationSources.status,
        },
        input,
      ),
    )
    .where(
      and(
        eq(organizationCorporationSources.organizationVersion, input.organizationVersion),
        isNull(organizationCorporationSources.invalidatedAt),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
    .returning({
      invalidatedAt: organizationCorporationSources.invalidatedAt,
      organizationVersion: organizationCorporationSources.organizationVersion,
      sourceId: organizationCorporationSources.sourceId,
      subjectType: sql<'corporation_source'>`'corporation_source'`,
      userId: organizationCorporationSources.sourceUserId,
    })
}
