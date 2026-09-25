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
import { OrganizationAuthorityError } from './authority-policy.js'
import { recomputeOrganizationAccountCompliance } from './compliance.js'
import { loadCurrentOrganizationIdentity } from './context.js'
import {
  commitCorporationRoleBootstrapInTransaction,
  CorporationRoleBootstrapError,
  prepareCorporationRoleBootstrap,
  type CorporationRoleBootstrapObservation,
} from './corporation-role-bootstrap.js'
import type { AuthorityCorporationEvidence } from './corporation-role-convergence.js'
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
  organizationId: number
  organizationVersion: number
  authorityCorporation: AuthorityCorporationEvidence
  requiredScope: string
  signal?: AbortSignal
  observation?: CorporationRoleBootstrapObservation
}

const toOwnerClaimError = (error: CorporationRoleBootstrapError) => {
  if (error.code === 'not-director') {
    return new OrganizationAuthorityError('not-director')
  }
  if (error.code === 'missing-scope') {
    return new OrganizationOwnerClaimError('missing-scope')
  }
  return new OrganizationOwnerClaimError(
    error.code === 'character-ineligible' || error.code === 'superseded'
      ? 'character-not-owned'
      : 'stale-affiliation',
  )
}

const withOwnerClaimErrors = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof CorporationRoleBootstrapError) {
      throw toOwnerClaimError(error)
    }
    throw error
  }
}

export async function claimOrganizationOwnership(input: OrganizationOwnerClaimInput) {
  const currentOrganization = await loadCurrentOrganizationIdentity()
  if (
    currentOrganization.organizationId !== input.organizationId ||
    currentOrganization.organizationVersion !== input.organizationVersion
  ) {
    throw new OrganizationOwnerClaimError('stale-organization')
  }
  const prepared = await withOwnerClaimErrors(() =>
    prepareCorporationRoleBootstrap({
      characterId: input.characterId,
      userId: input.userId,
      ...(input.observation && { observation: input.observation }),
      ...(input.signal && { signal: input.signal }),
    }),
  )
  if (prepared.binding.subjectLifecycleId !== input.subjectLifecycleId) {
    throw new OrganizationOwnerClaimError('character-not-owned')
  }
  return db.transaction(async (transaction) => {
    const roleEvidence = await withOwnerClaimErrors(() =>
      commitCorporationRoleBootstrapInTransaction(transaction, prepared, {
        authorityCorporation: input.authorityCorporation,
        authorize: async (_transaction, binding) =>
          binding.organizationVersion === input.organizationVersion &&
          binding.subjectLifecycleId === input.subjectLifecycleId &&
          binding.authorityCorporationId === input.authorityCorporation.corporationId,
        intent: { actorUserId: input.userId, kind: 'organization-owner-claim' },
        ...(input.signal && { signal: input.signal }),
      }),
    )
    const [organization] = await transaction
      .select({
        authorityEvidenceFreshDurationSeconds:
          deploymentSettings.authorityEvidenceFreshDurationSeconds,
        deploymentId: deploymentSettings.id,
        organizationId: deploymentSettings.organizationId,
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (
      organization?.organizationId !== input.organizationId ||
      organization?.organizationVersion !== input.organizationVersion
    ) {
      throw new OrganizationOwnerClaimError('stale-organization')
    }

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
    if (activeBlock) {
      throw new OrganizationOwnerClaimError('member-blocked')
    }

    const [character] = await transaction
      .select({
        affiliationPeriodRevision: characters.affiliationPeriodRevision,
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
    assertClaimCharacterOwned(character, input, roleEvidence.binding.authorizationGeneration)
    if (!claimAffiliationMatches(character, input, roleEvidence.binding)) {
      throw new OrganizationOwnerClaimError('stale-affiliation')
    }
    if (!character.scopes.includes(input.requiredScope)) {
      throw new OrganizationOwnerClaimError('missing-scope')
    }

    const now = new Date()
    const freshUntil = new Date(
      Math.min(
        roleEvidence.freshUntil.getTime(),
        input.authorityCorporation.freshUntil?.getTime() ?? Number.POSITIVE_INFINITY,
        now.getTime() + organization.authorityEvidenceFreshDurationSeconds * 1000,
      ),
    )
    if (freshUntil <= now) {
      throw new OrganizationOwnerClaimError('stale-affiliation')
    }
    const [existingOwner] = await transaction
      .select({
        evidenceId: organizationAuthorityEvidence.evidenceId,
        freshUntil: organizationAuthorityEvidence.freshUntil,
        graceUntil: organizationAuthorityEvidence.graceUntil,
        grantId: organizationRoleGrants.grantId,
        invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
        status: organizationAuthorityEvidence.status,
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
    if (existingOwner?.grantId && !isOrganizationOwnerClaimAvailable(existingOwner, now)) {
      throw new OrganizationOwnerClaimError('owner-already-claimed')
    }
    if (existingOwner) {
      await transaction
        .update(organizationRoleGrants)
        .set({
          revocationReason: 'Replaced after organization-owner authority became invalid.',
          revokedAt: now,
          revokedByUserId: null,
          updatedAt: now,
        })
        .where(eq(organizationRoleGrants.grantId, existingOwner.grantId))
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
        .where(eq(organizationAuthorityEvidence.grantId, existingOwner.grantId))
      await appendOrganizationAuditEvents(transaction, [
        {
          actorId: null,
          actorType: 'system',
          deploymentId: 1,
          eventType: 'role.revoked',
          occurredAt: now,
          organizationVersion: organization.organizationVersion,
          outcome: 'revoked',
          policyVersion: organization.policyVersion,
          reason: 'Replaced after organization-owner authority became invalid.',
          subjectId: existingOwner.grantId,
          subjectType: 'role_grant',
        },
        ...(existingOwner.evidenceId
          ? [
              {
                actorId: null,
                actorType: 'system' as const,
                deploymentId: 1 as const,
                eventType: 'authority-source.invalidated' as const,
                occurredAt: now,
                organizationVersion: organization.organizationVersion,
                outcome: 'revoked' as const,
                policyVersion: organization.policyVersion,
                reason: 'Invalid organization-owner evidence was replaced by a fresh source.',
                subjectId: existingOwner.evidenceId,
                subjectType: 'authority_source' as const,
              },
            ]
          : []),
      ])
    }

    const [grant] = await transaction
      .insert(organizationRoleGrants)
      .values({
        deploymentId: organization.deploymentId,
        grantedAt: now,
        grantedByUserId: input.userId,
        organizationVersion: organization.organizationVersion,
        reason: 'Verified initial EVE Director authority claim.',
        role: 'organization_owner',
        userId: input.userId,
      })
      .returning({ grantId: organizationRoleGrants.grantId })
    if (!grant) {
      throw new Error('Failed to create organization-owner grant')
    }

    const [evidence] = await transaction
      .insert(organizationAuthorityEvidence)
      .values({
        affiliationPeriodRevision: roleEvidence.binding.affiliationPeriodRevision,
        authorityCorporationId: input.authorityCorporation.corporationId,
        authorizationGeneration: roleEvidence.binding.authorizationGeneration,
        characterId: input.characterId,
        deploymentId: 1,
        directorRolePresent: true,
        freshUntil,
        grantId: grant.grantId,
        lastCheckedAt: now,
        observedAllianceId: character.allianceId,
        observedAt: now,
        observedCorporationId: character.corporationId,
        organizationVersion: organization.organizationVersion,
        requiredScope: input.requiredScope,
        role: 'organization_owner',
        roleEvidenceRevision: roleEvidence.roleEvidenceRevision,
        sourceSubjectLifecycleId: input.subjectLifecycleId,
        status: 'fresh',
        userId: input.userId,
      })
      .returning({ evidenceId: organizationAuthorityEvidence.evidenceId })
    if (!evidence) {
      throw new Error('Failed to create organization-owner evidence')
    }
    await appendOrganizationAuditEvents(transaction, [
      {
        actorId: input.userId,
        actorType: 'user',
        deploymentId: 1,
        eventType: 'role.granted',
        occurredAt: now,
        organizationVersion: organization.organizationVersion,
        outcome: 'granted',
        policyVersion: organization.policyVersion,
        reason: 'Verified initial EVE Director authority claim.',
        subjectId: grant.grantId,
        subjectType: 'role_grant',
      },
      {
        actorId: input.userId,
        actorType: 'user',
        deploymentId: 1,
        eventType: 'authority-source.observed',
        occurredAt: now,
        organizationVersion: organization.organizationVersion,
        outcome: 'granted',
        policyVersion: organization.policyVersion,
        reason: 'Fresh organization-owner authority evidence was observed.',
        subjectId: evidence.evidenceId,
        subjectType: 'authority_source',
      },
    ])
    await recomputeOrganizationAccountCompliance(
      {
        deploymentId: 1,
        now,
        organizationVersion: organization.organizationVersion,
        userId: input.userId,
      },
      transaction,
    )
    return grant
  })
}

function assertClaimCharacterOwned(
  character:
    | {
        userId: string
        subjectLifecycleId: string
        authorizationGeneration: number
      }
    | undefined,
  input: OrganizationOwnerClaimInput,
  evidenceAuthorizationGeneration: number,
): asserts character is NonNullable<typeof character> {
  if (
    character?.userId !== input.userId ||
    character.subjectLifecycleId !== input.subjectLifecycleId ||
    character.authorizationGeneration !== evidenceAuthorizationGeneration
  ) {
    throw new OrganizationOwnerClaimError('character-not-owned')
  }
}

function claimAffiliationMatches(
  character: Pick<
    typeof characters.$inferSelect,
    'affiliationResolutionState' | 'affiliationPeriodRevision' | 'corporationId'
  >,
  input: OrganizationOwnerClaimInput,
  binding: { readonly affiliationPeriodRevision: string; readonly authorityCorporationId: number },
) {
  return (
    character.affiliationResolutionState === 'resolved' &&
    character.affiliationPeriodRevision === binding.affiliationPeriodRevision &&
    character.corporationId === binding.authorityCorporationId &&
    character.corporationId === input.authorityCorporation.corporationId
  )
}
