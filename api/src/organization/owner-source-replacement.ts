import { and, eq, isNull } from 'drizzle-orm'
import {
  characterCorporationRolesScope,
  getCharacterCorporationRolesEvidence,
  type CharacterCorporationRolesEvidence,
} from '../characters/corporation-roles.js'
import { observeAndPersistCharacterAffiliation } from '../characters/affiliation-sync.js'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAuthorityEvidence,
  organizationRoleGrants,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { resolveOrganizationAuthorityCorporationEvidence } from './authority.js'
import { appendOrganizationAuditEvents } from './audit.js'
import { convergeObservedAffiliationInTransaction } from './authority-convergence.js'
import {
  assertOrganizationOwnerAuthorization,
  OrganizationAuthorityError,
} from './authority-policy.js'
import { loadEffectiveOrganizationAuthority } from './effective-authority.js'

export class OrganizationOwnerSourceReplacementError extends Error {
  constructor(
    readonly code:
      | 'owner-authority-required'
      | 'replacement-not-owned'
      | 'replacement-ineligible'
      | 'replacement-stale',
  ) {
    super(code)
  }
}

export async function replaceOrganizationOwnerSource(input: {
  actorUserId: string
  characterId: number
  reason: string
  signal?: AbortSignal
}) {
  input.signal?.throwIfAborted()
  const snapshot = await loadReplacementSnapshot(input.actorUserId, input.characterId)
  if (!snapshot) throw new OrganizationOwnerSourceReplacementError('replacement-not-owned')
  let authorityCorporation: Awaited<
    ReturnType<typeof resolveOrganizationAuthorityCorporationEvidence>
  >
  let affiliation: Awaited<ReturnType<typeof observeAndPersistCharacterAffiliation>>
  let roles: CharacterCorporationRolesEvidence
  try {
    roles = await getCharacterCorporationRolesEvidence(
      input.characterId,
      snapshot.subjectLifecycleId,
      input.signal,
    )
    if (roles.stale) throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    assertOrganizationOwnerAuthorization(characterCorporationRolesScope, snapshot.scopes, roles)
    affiliation = await observeAndPersistCharacterAffiliation(
      input.characterId,
      input.signal,
      convergeObservedAffiliationInTransaction,
    )
    if (!affiliation || affiliation.stale)
      throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    authorityCorporation = await resolveOrganizationAuthorityCorporationEvidence(
      snapshot,
      affiliation,
    )
  } catch (error) {
    if (error instanceof OrganizationOwnerSourceReplacementError) throw error
    if (error instanceof OrganizationAuthorityError)
      throw new OrganizationOwnerSourceReplacementError('replacement-ineligible')
    throw error
  }
  input.signal?.throwIfAborted()

  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
        freshDurationSeconds: deploymentSettings.authorityEvidenceFreshDurationSeconds,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (organization?.organizationVersion !== snapshot.organizationVersion)
      throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    input.signal?.throwIfAborted()

    const [replacement] = await transaction
      .select({
        userId: characters.userId,
        corporationId: characters.corporationId,
        allianceId: characters.allianceId,
        affiliationCheckedAt: characters.affiliationCheckedAt,
        affiliationResolutionState: characters.affiliationResolutionState,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        authorizationGeneration: eveTokens.tokenVersion,
        scopes: eveTokens.scopes,
      })
      .from(characters)
      .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .innerJoin(
        platformSubjectLifecycles,
        eq(platformSubjectLifecycles.characterId, characters.characterId),
      )
      .where(eq(characters.characterId, input.characterId))
      .for('update')
    input.signal?.throwIfAborted()
    if (
      replacement?.userId !== input.actorUserId ||
      replacement.subjectLifecycleId !== snapshot.subjectLifecycleId ||
      replacement.corporationId !== authorityCorporation.corporationId ||
      replacement.corporationId !== affiliation.corporationId ||
      replacement.allianceId !== affiliation.allianceId ||
      replacement.affiliationResolutionState !== 'resolved' ||
      !replacement.affiliationCheckedAt ||
      replacement.affiliationCheckedAt < affiliation.affiliationCheckedAt ||
      replacement.authorizationGeneration !== roles.authorizationGeneration ||
      !replacement.scopes.includes(characterCorporationRolesScope)
    )
      throw new OrganizationOwnerSourceReplacementError('replacement-stale')

    const [current] = await transaction
      .select({
        grantId: organizationRoleGrants.grantId,
        evidenceId: organizationAuthorityEvidence.evidenceId,
      })
      .from(organizationRoleGrants)
      .innerJoin(
        organizationAuthorityEvidence,
        eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
      )
      .where(
        and(
          eq(organizationRoleGrants.deploymentId, 1),
          eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
          eq(organizationRoleGrants.userId, input.actorUserId),
          eq(organizationRoleGrants.role, 'organization_owner'),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
      .for('update')
    if (!current) throw new OrganizationOwnerSourceReplacementError('owner-authority-required')
    input.signal?.throwIfAborted()
    const authority = await loadEffectiveOrganizationAuthority(
      transaction,
      organization.organizationVersion,
      input.actorUserId,
      'remediate',
    )
    if (!authority.organizationOwner)
      throw new OrganizationOwnerSourceReplacementError('owner-authority-required')
    input.signal?.throwIfAborted()

    const now = new Date()
    const freshUntil = earliestDate(
      affiliation.affiliationFreshUntil,
      roles.freshUntil,
      authorityCorporation.freshUntil,
      new Date(now.getTime() + organization.freshDurationSeconds * 1_000),
    )
    if (freshUntil <= now) throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    await transaction
      .update(organizationRoleGrants)
      .set({
        revokedAt: now,
        revokedByUserId: input.actorUserId,
        revocationReason: input.reason,
        updatedAt: now,
      })
      .where(eq(organizationRoleGrants.grantId, current.grantId))
    input.signal?.throwIfAborted()
    await transaction
      .update(organizationAuthorityEvidence)
      .set({
        status: 'invalid',
        graceUntil: null,
        failureClass: 'strict:source-replaced',
        invalidatedAt: now,
        invalidationOutcome: 'source-replaced',
        updatedAt: now,
      })
      .where(eq(organizationAuthorityEvidence.grantId, current.grantId))
    input.signal?.throwIfAborted()

    const [grant] = await transaction
      .insert(organizationRoleGrants)
      .values({
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        userId: input.actorUserId,
        role: 'organization_owner',
        grantedByUserId: input.actorUserId,
        reason: input.reason,
        grantedAt: now,
      })
      .returning({ grantId: organizationRoleGrants.grantId })
    input.signal?.throwIfAborted()
    if (!grant) throw new Error('Failed to create replacement organization-owner grant')
    const [evidence] = await transaction
      .insert(organizationAuthorityEvidence)
      .values({
        grantId: grant.grantId,
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        userId: input.actorUserId,
        role: 'organization_owner',
        characterId: input.characterId,
        sourceSubjectLifecycleId: replacement.subjectLifecycleId,
        authorityCorporationId: authorityCorporation.corporationId,
        observedCorporationId: replacement.corporationId,
        observedAllianceId: replacement.allianceId,
        requiredScope: characterCorporationRolesScope,
        authorizationGeneration: replacement.authorizationGeneration,
        roleEvidenceRevision: roles.roleEvidenceRevision,
        directorRolePresent: true,
        status: 'fresh',
        observedAt: now,
        freshUntil,
        lastCheckedAt: now,
      })
      .returning()
    input.signal?.throwIfAborted()
    if (!evidence) throw new Error('Failed to create replacement owner evidence')
    await appendOrganizationAuditEvents(transaction, [
      {
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        policyVersion: organization.policyVersion,
        eventType: 'role.revoked',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'role_grant',
        subjectId: current.grantId,
        reason: input.reason,
        outcome: 'revoked',
        occurredAt: now,
      },
      {
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        policyVersion: organization.policyVersion,
        eventType: 'authority-source.invalidated',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'authority_source',
        subjectId: current.evidenceId,
        reason: input.reason,
        outcome: 'revoked',
        occurredAt: now,
      },
      {
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        policyVersion: organization.policyVersion,
        eventType: 'role.granted',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'role_grant',
        subjectId: grant.grantId,
        reason: input.reason,
        outcome: 'granted',
        occurredAt: now,
      },
      {
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        policyVersion: organization.policyVersion,
        eventType: 'authority-source.observed',
        actorType: 'user',
        actorId: input.actorUserId,
        subjectType: 'authority_source',
        subjectId: evidence.evidenceId,
        reason: 'Fresh replacement organization-owner evidence was observed.',
        outcome: 'granted',
        occurredAt: now,
      },
    ])
    input.signal?.throwIfAborted()
    return {
      grantId: grant.grantId,
      sourceCharacterId: evidence.characterId,
      sourceSubjectLifecycleId: evidence.sourceSubjectLifecycleId,
      status: evidence.status,
      freshUntil: evidence.freshUntil.toISOString(),
    }
  })
}

async function loadReplacementSnapshot(userId: string, characterId: number) {
  const [snapshot] = await db
    .select({
      organizationType: deploymentSettings.organizationType,
      organizationId: deploymentSettings.organizationId,
      organizationVersion: deploymentSettings.organizationVersion,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      scopes: eveTokens.scopes,
    })
    .from(characters)
    .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(deploymentSettings, eq(deploymentSettings.id, 1))
    .where(and(eq(characters.characterId, characterId), eq(characters.userId, userId)))
  return snapshot ?? null
}

function earliestDate(first: Date, ...dates: readonly (Date | null)[]) {
  return new Date(
    Math.min(
      first.getTime(),
      ...dates.filter((date): date is Date => date !== null).map((date) => date.getTime()),
    ),
  )
}
