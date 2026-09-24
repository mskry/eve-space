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
  if (!snapshot) {
    throw new OrganizationOwnerSourceReplacementError('replacement-not-owned')
  }
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
    if (roles.stale) {
      throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    }
    assertOrganizationOwnerAuthorization(characterCorporationRolesScope, snapshot.scopes, roles)
    affiliation = await observeAndPersistCharacterAffiliation(
      input.characterId,
      input.signal,
      convergeObservedAffiliationInTransaction,
    )
    if (!affiliation || affiliation.stale) {
      throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    }
    authorityCorporation = await resolveOrganizationAuthorityCorporationEvidence(
      snapshot,
      affiliation,
    )
  } catch (error) {
    if (error instanceof OrganizationOwnerSourceReplacementError) {
      throw error
    }
    if (error instanceof OrganizationAuthorityError) {
      throw new OrganizationOwnerSourceReplacementError('replacement-ineligible')
    }
    throw error
  }
  input.signal?.throwIfAborted()

  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        freshDurationSeconds: deploymentSettings.authorityEvidenceFreshDurationSeconds,
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (organization?.organizationVersion !== snapshot.organizationVersion) {
      throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    }
    input.signal?.throwIfAborted()

    const [replacement] = await transaction
      .select({
        affiliationCheckedAt: characters.affiliationCheckedAt,
        affiliationResolutionState: characters.affiliationResolutionState,
        allianceId: characters.allianceId,
        authorizationGeneration: eveTokens.tokenVersion,
        corporationId: characters.corporationId,
        scopes: eveTokens.scopes,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        userId: characters.userId,
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
    if (!replacement) {
      throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    }
    const replacementMatches = () =>
      replacement.userId === input.actorUserId &&
      replacement.subjectLifecycleId === snapshot.subjectLifecycleId &&
      replacement.corporationId === authorityCorporation.corporationId &&
      replacement.corporationId === affiliation.corporationId &&
      replacement.allianceId === affiliation.allianceId &&
      replacement.affiliationResolutionState === 'resolved' &&
      replacement.affiliationCheckedAt !== null &&
      replacement.affiliationCheckedAt >= affiliation.affiliationCheckedAt &&
      replacement.authorizationGeneration === roles.authorizationGeneration &&
      replacement.scopes.includes(characterCorporationRolesScope)
    if (!replacementMatches()) {
      throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    }

    const [current] = await transaction
      .select({
        evidenceId: organizationAuthorityEvidence.evidenceId,
        grantId: organizationRoleGrants.grantId,
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
    if (!current) {
      throw new OrganizationOwnerSourceReplacementError('owner-authority-required')
    }
    input.signal?.throwIfAborted()
    const authority = await loadEffectiveOrganizationAuthority(
      transaction,
      organization.organizationVersion,
      input.actorUserId,
      'remediate',
    )
    if (!authority.organizationOwner) {
      throw new OrganizationOwnerSourceReplacementError('owner-authority-required')
    }
    input.signal?.throwIfAborted()

    const now = new Date()
    const freshUntil = earliestDate(
      affiliation.affiliationFreshUntil,
      roles.freshUntil,
      authorityCorporation.freshUntil,
      new Date(now.getTime() + organization.freshDurationSeconds * 1000),
    )
    if (freshUntil <= now) {
      throw new OrganizationOwnerSourceReplacementError('replacement-stale')
    }
    await transaction
      .update(organizationRoleGrants)
      .set({
        revocationReason: input.reason,
        revokedAt: now,
        revokedByUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(eq(organizationRoleGrants.grantId, current.grantId))
    input.signal?.throwIfAborted()
    await transaction
      .update(organizationAuthorityEvidence)
      .set({
        failureClass: 'strict:source-replaced',
        graceUntil: null,
        invalidatedAt: now,
        invalidationOutcome: 'source-replaced',
        status: 'invalid',
        updatedAt: now,
      })
      .where(eq(organizationAuthorityEvidence.grantId, current.grantId))
    input.signal?.throwIfAborted()

    const [grant] = await transaction
      .insert(organizationRoleGrants)
      .values({
        deploymentId: 1,
        grantedAt: now,
        grantedByUserId: input.actorUserId,
        organizationVersion: organization.organizationVersion,
        reason: input.reason,
        role: 'organization_owner',
        userId: input.actorUserId,
      })
      .returning({ grantId: organizationRoleGrants.grantId })
    input.signal?.throwIfAborted()
    if (!grant) {
      throw new Error('Failed to create replacement organization-owner grant')
    }
    const [evidence] = await transaction
      .insert(organizationAuthorityEvidence)
      .values({
        authorityCorporationId: authorityCorporation.corporationId,
        authorizationGeneration: replacement.authorizationGeneration,
        characterId: input.characterId,
        deploymentId: 1,
        directorRolePresent: true,
        freshUntil,
        grantId: grant.grantId,
        lastCheckedAt: now,
        observedAllianceId: replacement.allianceId,
        observedAt: now,
        observedCorporationId: replacement.corporationId,
        organizationVersion: organization.organizationVersion,
        requiredScope: characterCorporationRolesScope,
        role: 'organization_owner',
        roleEvidenceRevision: roles.roleEvidenceRevision,
        sourceSubjectLifecycleId: replacement.subjectLifecycleId,
        status: 'fresh',
        userId: input.actorUserId,
      })
      .returning()
    input.signal?.throwIfAborted()
    if (!evidence) {
      throw new Error('Failed to create replacement owner evidence')
    }
    await appendOrganizationAuditEvents(transaction, [
      {
        actorId: input.actorUserId,
        actorType: 'user',
        deploymentId: 1,
        eventType: 'role.revoked',
        occurredAt: now,
        organizationVersion: organization.organizationVersion,
        outcome: 'revoked',
        policyVersion: organization.policyVersion,
        reason: input.reason,
        subjectId: current.grantId,
        subjectType: 'role_grant',
      },
      {
        actorId: input.actorUserId,
        actorType: 'user',
        deploymentId: 1,
        eventType: 'authority-source.invalidated',
        occurredAt: now,
        organizationVersion: organization.organizationVersion,
        outcome: 'revoked',
        policyVersion: organization.policyVersion,
        reason: input.reason,
        subjectId: current.evidenceId,
        subjectType: 'authority_source',
      },
      {
        actorId: input.actorUserId,
        actorType: 'user',
        deploymentId: 1,
        eventType: 'role.granted',
        occurredAt: now,
        organizationVersion: organization.organizationVersion,
        outcome: 'granted',
        policyVersion: organization.policyVersion,
        reason: input.reason,
        subjectId: grant.grantId,
        subjectType: 'role_grant',
      },
      {
        actorId: input.actorUserId,
        actorType: 'user',
        deploymentId: 1,
        eventType: 'authority-source.observed',
        occurredAt: now,
        organizationVersion: organization.organizationVersion,
        outcome: 'granted',
        policyVersion: organization.policyVersion,
        reason: 'Fresh replacement organization-owner evidence was observed.',
        subjectId: evidence.evidenceId,
        subjectType: 'authority_source',
      },
    ])
    input.signal?.throwIfAborted()
    return {
      freshUntil: evidence.freshUntil.toISOString(),
      grantId: grant.grantId,
      sourceCharacterId: evidence.characterId,
      sourceSubjectLifecycleId: evidence.sourceSubjectLifecycleId,
      status: evidence.status,
    }
  })
}

async function loadReplacementSnapshot(userId: string, characterId: number) {
  const [snapshot] = await db
    .select({
      organizationId: deploymentSettings.organizationId,
      organizationType: deploymentSettings.organizationType,
      organizationVersion: deploymentSettings.organizationVersion,
      scopes: eveTokens.scopes,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
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
