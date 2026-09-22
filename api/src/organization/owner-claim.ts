import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAuthorityEvidence,
  organizationMemberBlocks,
  organizationRoleGrants,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { appendOrganizationAuditEvents } from './audit.js'
import { recomputeOrganizationAccountCompliance } from './compliance.js'
import { isOrganizationOwnerClaimAvailable } from './owner-claim-policy.js'

export class OrganizationOwnerClaimError extends Error {
  constructor(
    readonly code:
      | 'stale-organization'
      | 'character-not-owned'
      | 'stale-affiliation'
      | 'missing-scope'
      | 'member-blocked'
      | 'owner-already-claimed',
  ) {
    super(code)
  }
}

interface OrganizationOwnerClaimInput {
  userId: string
  characterId: number
  subjectLifecycleId: string
  authorizationGeneration: number
  roleEvidenceRevision: string
  evidenceAuthorizationGeneration: number
  evidenceFreshUntil: Date
  organizationId: number
  organizationVersion: number
  authorityCorporationId: number
  observedCorporationId: number
  observedAllianceId: number | null
  affiliationCheckedAt: Date
  requiredScope: string
}

export async function claimOrganizationOwnership(input: OrganizationOwnerClaimInput) {
  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        deploymentId: deploymentSettings.id,
        organizationId: deploymentSettings.organizationId,
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
        authorityEvidenceFreshDurationSeconds:
          deploymentSettings.authorityEvidenceFreshDurationSeconds,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (
      organization?.organizationId !== input.organizationId ||
      organization?.organizationVersion !== input.organizationVersion
    )
      throw new OrganizationOwnerClaimError('stale-organization')

    const [activeBlock] = await transaction
      .select({ blockId: organizationMemberBlocks.blockId })
      .from(organizationMemberBlocks)
      .where(
        and(
          eq(organizationMemberBlocks.deploymentId, organization.deploymentId),
          eq(organizationMemberBlocks.organizationVersion, organization.organizationVersion),
          eq(organizationMemberBlocks.userId, input.userId),
          isNull(organizationMemberBlocks.unblockedAt),
        ),
      )
      .limit(1)
    if (activeBlock) throw new OrganizationOwnerClaimError('member-blocked')

    const [character] = await transaction
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
    if (
      character?.userId !== input.userId ||
      character.subjectLifecycleId !== input.subjectLifecycleId
    )
      throw new OrganizationOwnerClaimError('character-not-owned')
    if (character.authorizationGeneration !== input.authorizationGeneration)
      throw new OrganizationOwnerClaimError('character-not-owned')
    if (character.authorizationGeneration !== input.evidenceAuthorizationGeneration)
      throw new OrganizationOwnerClaimError('character-not-owned')
    if (
      character.affiliationResolutionState !== 'resolved' ||
      !character.affiliationCheckedAt ||
      character.affiliationCheckedAt < input.affiliationCheckedAt ||
      character.corporationId !== input.observedCorporationId ||
      character.allianceId !== input.observedAllianceId ||
      character.corporationId !== input.authorityCorporationId
    )
      throw new OrganizationOwnerClaimError('stale-affiliation')
    if (!character.scopes.includes(input.requiredScope))
      throw new OrganizationOwnerClaimError('missing-scope')

    const now = new Date()
    const freshUntil = new Date(
      Math.min(
        input.evidenceFreshUntil.getTime(),
        now.getTime() + organization.authorityEvidenceFreshDurationSeconds * 1_000,
      ),
    )
    if (freshUntil <= now) throw new OrganizationOwnerClaimError('stale-affiliation')
    const [existingOwner] = await transaction
      .select({
        grantId: organizationRoleGrants.grantId,
        evidenceId: organizationAuthorityEvidence.evidenceId,
        status: organizationAuthorityEvidence.status,
        freshUntil: organizationAuthorityEvidence.freshUntil,
        graceUntil: organizationAuthorityEvidence.graceUntil,
        invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      })
      .from(organizationRoleGrants)
      .leftJoin(
        organizationAuthorityEvidence,
        eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
      )
      .where(
        and(
          eq(organizationRoleGrants.deploymentId, organization.deploymentId),
          eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
          eq(organizationRoleGrants.role, 'organization_owner'),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
      .limit(1)
    if (existingOwner?.grantId && !isOrganizationOwnerClaimAvailable(existingOwner, now))
      throw new OrganizationOwnerClaimError('owner-already-claimed')
    if (existingOwner) {
      await transaction
        .update(organizationRoleGrants)
        .set({
          revokedAt: now,
          revokedByUserId: null,
          revocationReason: 'Replaced after organization-owner authority became invalid.',
          updatedAt: now,
        })
        .where(eq(organizationRoleGrants.grantId, existingOwner.grantId))
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
        .where(eq(organizationAuthorityEvidence.grantId, existingOwner.grantId))
      await appendOrganizationAuditEvents(transaction, [
        {
          deploymentId: 1,
          organizationVersion: organization.organizationVersion,
          policyVersion: organization.policyVersion,
          eventType: 'role.revoked',
          actorType: 'system',
          actorId: null,
          subjectType: 'role_grant',
          subjectId: existingOwner.grantId,
          reason: 'Replaced after organization-owner authority became invalid.',
          outcome: 'revoked',
          occurredAt: now,
        },
        ...(existingOwner.evidenceId
          ? [
              {
                deploymentId: 1 as const,
                organizationVersion: organization.organizationVersion,
                policyVersion: organization.policyVersion,
                eventType: 'authority-source.invalidated' as const,
                actorType: 'system' as const,
                actorId: null,
                subjectType: 'authority_source' as const,
                subjectId: existingOwner.evidenceId,
                reason: 'Invalid organization-owner evidence was replaced by a fresh source.',
                outcome: 'revoked' as const,
                occurredAt: now,
              },
            ]
          : []),
      ])
    }

    const [grant] = await transaction
      .insert(organizationRoleGrants)
      .values({
        deploymentId: organization.deploymentId,
        organizationVersion: organization.organizationVersion,
        userId: input.userId,
        role: 'organization_owner',
        grantedByUserId: input.userId,
        reason: 'Verified initial EVE Director authority claim.',
        grantedAt: now,
      })
      .returning({ grantId: organizationRoleGrants.grantId })
    if (!grant) throw new Error('Failed to create organization-owner grant')

    const [evidence] = await transaction
      .insert(organizationAuthorityEvidence)
      .values({
        grantId: grant.grantId,
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        userId: input.userId,
        role: 'organization_owner',
        characterId: input.characterId,
        sourceSubjectLifecycleId: input.subjectLifecycleId,
        authorityCorporationId: input.authorityCorporationId,
        observedCorporationId: input.observedCorporationId,
        observedAllianceId: input.observedAllianceId,
        requiredScope: input.requiredScope,
        authorizationGeneration: input.authorizationGeneration,
        roleEvidenceRevision: input.roleEvidenceRevision,
        directorRolePresent: true,
        status: 'fresh',
        observedAt: now,
        freshUntil,
        lastCheckedAt: now,
      })
      .returning({ evidenceId: organizationAuthorityEvidence.evidenceId })
    if (!evidence) throw new Error('Failed to create organization-owner evidence')
    await appendOrganizationAuditEvents(transaction, [
      {
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        policyVersion: organization.policyVersion,
        eventType: 'role.granted',
        actorType: 'user',
        actorId: input.userId,
        subjectType: 'role_grant',
        subjectId: grant.grantId,
        reason: 'Verified initial EVE Director authority claim.',
        outcome: 'granted',
        occurredAt: now,
      },
      {
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        policyVersion: organization.policyVersion,
        eventType: 'authority-source.observed',
        actorType: 'user',
        actorId: input.userId,
        subjectType: 'authority_source',
        subjectId: evidence.evidenceId,
        reason: 'Fresh organization-owner authority evidence was observed.',
        outcome: 'granted',
        occurredAt: now,
      },
    ])
    await recomputeOrganizationAccountCompliance(
      {
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        userId: input.userId,
        now,
      },
      transaction,
    )
    return grant
  })
}
