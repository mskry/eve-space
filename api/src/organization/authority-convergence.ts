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
  if (!settings) return

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
      sourceId: organizationDerivedAuthoritySources.sourceId,
      organizationVersion: organizationDerivedAuthoritySources.organizationVersion,
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
      sourceId: organizationCorporationSources.sourceId,
      organizationVersion: organizationCorporationSources.organizationVersion,
      userId: organizationCorporationSources.sourceUserId,
    })

  await appendOrganizationAuditEvents(transaction, [
    ...ownerSources.map((source) => ({
      deploymentId: 1 as const,
      organizationVersion: source.organizationVersion,
      policyVersion: settings.policyVersion,
      eventType: 'authority-source.invalidated' as const,
      actorType: 'system' as const,
      actorId: null,
      subjectType: 'authority_source' as const,
      subjectId: source.evidenceId,
      reason: `Organization-owner source invalidated: ${input.outcome}.`,
      outcome: 'revoked' as const,
      occurredAt: now,
    })),
    ...derivedSources.map((source) => ({
      deploymentId: 1 as const,
      organizationVersion: source.organizationVersion,
      policyVersion: settings.policyVersion,
      eventType: 'authority-source.invalidated' as const,
      actorType: 'system' as const,
      actorId: null,
      subjectType: 'authority_source' as const,
      subjectId: source.sourceId,
      reason: `Derived Director source invalidated: ${input.outcome}.`,
      outcome: 'revoked' as const,
      occurredAt: now,
    })),
    ...corporationSources.map((source) => ({
      deploymentId: 1 as const,
      organizationVersion: source.organizationVersion,
      policyVersion: settings.policyVersion,
      eventType: 'authority-source.invalidated' as const,
      actorType: 'system' as const,
      actorId: null,
      subjectType: 'corporation_source' as const,
      subjectId: source.sourceId,
      reason: `Corporation source invalidated: ${input.outcome}.`,
      outcome: 'revoked' as const,
      occurredAt: now,
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
  if (input.userIds.length === 0) return
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
      outcome: 'affiliation-changed',
      now: input.now,
    })
  }
}

export async function convergeObservedAffiliationInTransaction(
  transaction: DatabaseTransaction,
  userIds: readonly string[],
  observedAt: Date,
) {
  await convergeCurrentManagedMemberLifecyclesInTransaction(transaction, {
    userIds,
    now: observedAt,
  })
  await convergeAffiliationAuthoritySourcesInTransaction(transaction, {
    userIds,
    now: observedAt,
  })
}

export async function invalidateOrganizationAuthoritySourcesInTransaction(
  transaction: DatabaseTransaction,
  input: { organizationVersion: number; policyVersion: number; now?: Date },
) {
  const now = input.now ?? new Date()
  const invalidation = {
    status: 'invalid' as const,
    graceUntil: null,
    failureClass: 'strict:organization-replaced',
    invalidatedAt: now,
    invalidationOutcome: 'organization-replaced' as const,
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
      sourceId: organizationAuthorityEvidence.evidenceId,
      organizationVersion: organizationAuthorityEvidence.organizationVersion,
      userId: organizationAuthorityEvidence.userId,
      subjectType: sql<'authority_source'>`'authority_source'`,
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
      sourceId: organizationDerivedAuthoritySources.sourceId,
      organizationVersion: organizationDerivedAuthoritySources.organizationVersion,
      userId: organizationDerivedAuthoritySources.userId,
      subjectType: sql<'authority_source'>`'authority_source'`,
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
      sourceId: organizationCorporationSources.sourceId,
      organizationVersion: organizationCorporationSources.organizationVersion,
      userId: organizationCorporationSources.sourceUserId,
      subjectType: sql<'corporation_source'>`'corporation_source'`,
    })
  const invalidated = [...ownerSources, ...derivedSources, ...corporationSources]
  await appendOrganizationAuditEvents(
    transaction,
    invalidated.map((source) => ({
      deploymentId: 1 as const,
      organizationVersion: source.organizationVersion,
      policyVersion: input.policyVersion,
      eventType: 'authority-source.invalidated' as const,
      actorType: 'system' as const,
      actorId: null,
      subjectType: source.subjectType,
      subjectId: source.sourceId,
      reason: 'Authority source invalidated because the managed organization changed.',
      outcome: 'revoked' as const,
      occurredAt: now,
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
      status: 'invalid',
      graceUntil: null,
      failureClass: 'strict:policy-disabled',
      invalidatedAt: now,
      invalidationOutcome: 'policy-disabled',
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationDerivedAuthoritySources.organizationVersion, input.organizationVersion),
        isNull(organizationDerivedAuthoritySources.invalidatedAt),
      ),
    )
    .returning({
      sourceId: organizationDerivedAuthoritySources.sourceId,
      organizationVersion: organizationDerivedAuthoritySources.organizationVersion,
      userId: organizationDerivedAuthoritySources.userId,
    })
  await appendOrganizationAuditEvents(
    transaction,
    sources.map((source) => ({
      deploymentId: 1 as const,
      organizationVersion: source.organizationVersion,
      policyVersion: input.policyVersion,
      eventType: 'authority-source.invalidated' as const,
      actorType: 'system' as const,
      actorId: null,
      subjectType: 'authority_source' as const,
      subjectId: source.sourceId,
      reason: 'Derived Director authority was disabled by organization policy.',
      outcome: 'revoked' as const,
      occurredAt: now,
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
      deploymentId: 1 as const,
      organizationVersion: input.organizationVersion,
      policyVersion: input.policyVersion,
      eventType: 'authority-source.invalidated' as const,
      actorType: 'system' as const,
      actorId: null,
      subjectType: source.subjectType,
      subjectId: source.sourceId,
      reason: 'Authority evidence expired under the updated policy deadline.',
      outcome: 'revoked' as const,
      occurredAt: input.now,
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
    freshUntil: boundedFreshUntil,
    graceUntil: sql<Date | null>`case
      when ${expired} then null
      when ${status} = 'degraded' then ${boundedGraceUntil}
      else null
    end`,
    status: sql<OrganizationAuthorityEvidenceStatus>`case when ${expired} then 'invalid' else ${status} end`,
    failureClass: sql<
      string | null
    >`case when ${expired} then 'strict:expired' else ${failureClass} end`,
    invalidatedAt: sql<Date | null>`case when ${expired} then ${input.now} else ${invalidatedAt} end`,
    invalidationOutcome: sql<OrganizationAuthorityInvalidationOutcome | null>`case when ${expired} then 'expired' else ${invalidationOutcome} end`,
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
          status: organizationAuthorityEvidence.status,
          observedAt: organizationAuthorityEvidence.observedAt,
          freshUntil: organizationAuthorityEvidence.freshUntil,
          graceUntil: organizationAuthorityEvidence.graceUntil,
          invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
          invalidationOutcome: organizationAuthorityEvidence.invalidationOutcome,
          failureClass: organizationAuthorityEvidence.failureClass,
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
      sourceId: organizationAuthorityEvidence.evidenceId,
      organizationVersion: organizationAuthorityEvidence.organizationVersion,
      userId: organizationAuthorityEvidence.userId,
      invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      subjectType: sql<'authority_source'>`'authority_source'`,
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
          status: organizationDerivedAuthoritySources.status,
          observedAt: organizationDerivedAuthoritySources.observedAt,
          freshUntil: organizationDerivedAuthoritySources.freshUntil,
          graceUntil: organizationDerivedAuthoritySources.graceUntil,
          invalidatedAt: organizationDerivedAuthoritySources.invalidatedAt,
          invalidationOutcome: organizationDerivedAuthoritySources.invalidationOutcome,
          failureClass: organizationDerivedAuthoritySources.failureClass,
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
      sourceId: organizationDerivedAuthoritySources.sourceId,
      organizationVersion: organizationDerivedAuthoritySources.organizationVersion,
      userId: organizationDerivedAuthoritySources.userId,
      invalidatedAt: organizationDerivedAuthoritySources.invalidatedAt,
      subjectType: sql<'authority_source'>`'authority_source'`,
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
          status: organizationCorporationSources.status,
          observedAt: organizationCorporationSources.observedAt,
          freshUntil: organizationCorporationSources.freshUntil,
          graceUntil: organizationCorporationSources.graceUntil,
          invalidatedAt: organizationCorporationSources.invalidatedAt,
          invalidationOutcome: organizationCorporationSources.invalidationOutcome,
          failureClass: organizationCorporationSources.failureClass,
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
      sourceId: organizationCorporationSources.sourceId,
      organizationVersion: organizationCorporationSources.organizationVersion,
      userId: organizationCorporationSources.sourceUserId,
      invalidatedAt: organizationCorporationSources.invalidatedAt,
      subjectType: sql<'corporation_source'>`'corporation_source'`,
    })
}
