import { and, asc, eq, gt, isNull, notExists, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationAuthorityEvidence,
  organizationMemberBlocks,
  organizationRoleGrants,
  users,
  type ElevatedOrganizationRole,
} from '../db/schema.js'
import { appendOrganizationAuditEvent } from './audit.js'

export type DelegatedOrganizationRole = Exclude<ElevatedOrganizationRole, 'organization_owner'>

interface OrganizationOwnerClaimState {
  failureClass: string | null
  reviewDeadline: Date | null
}

export function isOrganizationOwnerClaimAvailable(
  owner: OrganizationOwnerClaimState | undefined,
  now = new Date(),
) {
  return (
    !owner ||
    owner.failureClass?.startsWith('strict:') === true ||
    (owner.reviewDeadline !== null && owner.reviewDeadline <= now)
  )
}

export class OrganizationRoleMutationError extends Error {
  constructor(
    readonly code:
      | 'owner-authority-required'
      | 'target-not-found'
      | 'role-already-granted'
      | 'grant-not-found',
  ) {
    super(code)
  }
}

export async function hasCurrentOrganizationOwnerAuthority(userId: string, now = new Date()) {
  const [grant] = await db
    .select({ grantId: organizationRoleGrants.grantId })
    .from(deploymentSettings)
    .innerJoin(
      organizationRoleGrants,
      and(
        eq(organizationRoleGrants.deploymentId, deploymentSettings.id),
        eq(organizationRoleGrants.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .innerJoin(
      organizationAuthorityEvidence,
      eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(organizationRoleGrants.userId, userId),
        eq(organizationRoleGrants.role, 'organization_owner'),
        isNull(organizationRoleGrants.revokedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(organizationMemberBlocks)
            .where(
              and(
                eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
                eq(
                  organizationMemberBlocks.organizationVersion,
                  deploymentSettings.organizationVersion,
                ),
                eq(organizationMemberBlocks.userId, userId),
                isNull(organizationMemberBlocks.unblockedAt),
              ),
            ),
        ),
        or(
          eq(organizationAuthorityEvidence.status, 'fresh'),
          and(
            eq(organizationAuthorityEvidence.status, 'review_required'),
            gt(organizationAuthorityEvidence.reviewDeadline, now),
          ),
        ),
      ),
    )
    .limit(1)
  return Boolean(grant)
}

export async function hasCurrentOrganizationHrAuthority(userId: string) {
  const [grant] = await db
    .select({ grantId: organizationRoleGrants.grantId })
    .from(deploymentSettings)
    .innerJoin(
      organizationRoleGrants,
      and(
        eq(organizationRoleGrants.deploymentId, deploymentSettings.id),
        eq(organizationRoleGrants.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(organizationRoleGrants.userId, userId),
        eq(organizationRoleGrants.role, 'hr_auditor'),
        isNull(organizationRoleGrants.revokedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(organizationMemberBlocks)
            .where(
              and(
                eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
                eq(
                  organizationMemberBlocks.organizationVersion,
                  deploymentSettings.organizationVersion,
                ),
                eq(organizationMemberBlocks.userId, userId),
                isNull(organizationMemberBlocks.unblockedAt),
              ),
            ),
        ),
      ),
    )
    .limit(1)
  return Boolean(grant)
}

export async function getOrganizationAccessContext(userId: string) {
  const [organization] = await db
    .select({
      organizationType: deploymentSettings.organizationType,
      organizationId: deploymentSettings.organizationId,
      organizationName: deploymentSettings.organizationName,
      organizationTicker: deploymentSettings.organizationTicker,
      organizationVersion: deploymentSettings.organizationVersion,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) throw new Error('Deployment organization is not configured')

  const [owner] = await db
    .select({
      userId: organizationRoleGrants.userId,
      evidenceStatus: organizationAuthorityEvidence.status,
      reviewDeadline: organizationAuthorityEvidence.reviewDeadline,
      failureClass: organizationAuthorityEvidence.failureClass,
      characterId: organizationAuthorityEvidence.characterId,
      characterName: characters.name,
      authorityCorporationId: organizationAuthorityEvidence.authorityCorporationId,
      verifiedAt: organizationAuthorityEvidence.verifiedAt,
      lastCheckedAt: organizationAuthorityEvidence.lastCheckedAt,
    })
    .from(organizationRoleGrants)
    .leftJoin(
      organizationAuthorityEvidence,
      eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
    )
    .leftJoin(characters, eq(characters.characterId, organizationAuthorityEvidence.characterId))
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
        eq(organizationRoleGrants.role, 'organization_owner'),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .limit(1)
  const isOrganizationOwner = await hasCurrentOrganizationOwnerAuthority(userId)
  const canViewRosterCoverage = await hasCurrentOrganizationHrAuthority(userId)
  const [memberBlock] = await db
    .select({ blockId: organizationMemberBlocks.blockId })
    .from(organizationMemberBlocks)
    .where(
      and(
        eq(organizationMemberBlocks.deploymentId, 1),
        eq(organizationMemberBlocks.organizationVersion, organization.organizationVersion),
        eq(organizationMemberBlocks.userId, userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .limit(1)
  const isBlocked = Boolean(memberBlock)
  const claimAvailable = !isBlocked && isOrganizationOwnerClaimAvailable(owner)

  return {
    organization,
    isOrganizationOwner,
    isBlocked,
    capabilities: { viewRosterCoverage: canViewRosterCoverage },
    claimAvailable,
    ownerStatus: owner?.evidenceStatus ?? null,
    reviewDeadline: owner?.reviewDeadline?.toISOString() ?? null,
    authorityCharacter:
      owner?.userId === userId && owner.characterId && owner.characterName
        ? {
            characterId: owner.characterId,
            name: owner.characterName,
            corporationId: owner.authorityCorporationId,
            verifiedAt: owner.verifiedAt?.toISOString() ?? null,
            lastCheckedAt: owner.lastCheckedAt?.toISOString() ?? null,
          }
        : null,
  }
}

export async function listCurrentOrganizationRoles() {
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) throw new Error('Deployment organization is not configured')

  const grants = await db
    .select({
      grantId: organizationRoleGrants.grantId,
      userId: organizationRoleGrants.userId,
      role: organizationRoleGrants.role,
      reason: organizationRoleGrants.reason,
      grantedByUserId: organizationRoleGrants.grantedByUserId,
      grantedAt: organizationRoleGrants.grantedAt,
      mainCharacterId: characters.characterId,
      mainCharacterName: characters.name,
    })
    .from(organizationRoleGrants)
    .leftJoin(
      characters,
      and(eq(characters.userId, organizationRoleGrants.userId), eq(characters.isMain, true)),
    )
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
        or(
          eq(organizationRoleGrants.role, 'hr_auditor'),
          eq(organizationRoleGrants.role, 'director'),
        ),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .orderBy(asc(organizationRoleGrants.role), asc(organizationRoleGrants.grantedAt))

  return {
    grants: grants.map((grant) => ({
      grantId: grant.grantId,
      userId: grant.userId,
      role: grant.role as DelegatedOrganizationRole,
      reason: grant.reason,
      grantedByUserId: grant.grantedByUserId,
      grantedAt: grant.grantedAt.toISOString(),
      mainCharacterId: grant.mainCharacterId,
      mainCharacterName: grant.mainCharacterName,
    })),
  }
}

export async function grantOrganizationRole(input: {
  actorUserId: string
  targetUserId: string
  role: DelegatedOrganizationRole
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireOwnerAuthority(transaction, organization.organizationVersion, input.actorUserId)

    const [target] = await transaction
      .select({ userId: users.id })
      .from(users)
      .where(eq(users.id, input.targetUserId))
    if (!target) throw new OrganizationRoleMutationError('target-not-found')

    const [existing] = await transaction
      .select({ grantId: organizationRoleGrants.grantId })
      .from(organizationRoleGrants)
      .where(
        and(
          eq(organizationRoleGrants.deploymentId, 1),
          eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
          eq(organizationRoleGrants.userId, input.targetUserId),
          eq(organizationRoleGrants.role, input.role),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
    if (existing) throw new OrganizationRoleMutationError('role-already-granted')

    const now = new Date()
    const [grant] = await transaction
      .insert(organizationRoleGrants)
      .values({
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        userId: input.targetUserId,
        role: input.role,
        grantedByUserId: input.actorUserId,
        reason: input.reason,
        grantedAt: now,
      })
      .returning()
    if (!grant) throw new Error('Failed to create organization role grant')
    await appendOrganizationAuditEvent(transaction, {
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
    })
    return toRoleGrant(grant)
  })
}

export async function revokeOrganizationRole(input: {
  actorUserId: string
  grantId: string
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireOwnerAuthority(transaction, organization.organizationVersion, input.actorUserId)
    const [grant] = await transaction
      .select()
      .from(organizationRoleGrants)
      .where(
        and(
          eq(organizationRoleGrants.grantId, input.grantId),
          eq(organizationRoleGrants.deploymentId, 1),
          eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
          or(
            eq(organizationRoleGrants.role, 'hr_auditor'),
            eq(organizationRoleGrants.role, 'director'),
          ),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
      .for('update')
    if (!grant) throw new OrganizationRoleMutationError('grant-not-found')

    const now = new Date()
    const [revoked] = await transaction
      .update(organizationRoleGrants)
      .set({
        revokedAt: now,
        revokedByUserId: input.actorUserId,
        revocationReason: input.reason,
        updatedAt: now,
      })
      .where(eq(organizationRoleGrants.grantId, grant.grantId))
      .returning()
    if (!revoked) throw new Error('Failed to revoke organization role grant')
    await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: organization.organizationVersion,
      policyVersion: organization.policyVersion,
      eventType: 'role.revoked',
      actorType: 'user',
      actorId: input.actorUserId,
      subjectType: 'role_grant',
      subjectId: grant.grantId,
      reason: input.reason,
      outcome: 'revoked',
      occurredAt: now,
    })
    return toRoleGrant(revoked)
  })
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function lockCurrentOrganization(transaction: Transaction) {
  const [organization] = await transaction
    .select({
      organizationVersion: deploymentSettings.organizationVersion,
      policyVersion: deploymentSettings.registrationPolicyVersion,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
    .for('update')
  if (!organization) throw new Error('Deployment organization is not configured')
  return organization
}

async function requireOwnerAuthority(
  transaction: Transaction,
  organizationVersion: number,
  userId: string,
) {
  const now = new Date()
  const [owner] = await transaction
    .select({ grantId: organizationRoleGrants.grantId })
    .from(organizationRoleGrants)
    .innerJoin(
      organizationAuthorityEvidence,
      eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
    )
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organizationVersion),
        eq(organizationRoleGrants.userId, userId),
        eq(organizationRoleGrants.role, 'organization_owner'),
        isNull(organizationRoleGrants.revokedAt),
        notExists(
          transaction
            .select({ one: sql`1` })
            .from(organizationMemberBlocks)
            .where(
              and(
                eq(organizationMemberBlocks.deploymentId, 1),
                eq(organizationMemberBlocks.organizationVersion, organizationVersion),
                eq(organizationMemberBlocks.userId, userId),
                isNull(organizationMemberBlocks.unblockedAt),
              ),
            ),
        ),
        or(
          eq(organizationAuthorityEvidence.status, 'fresh'),
          and(
            eq(organizationAuthorityEvidence.status, 'review_required'),
            gt(organizationAuthorityEvidence.reviewDeadline, now),
          ),
        ),
      ),
    )
  if (!owner) throw new OrganizationRoleMutationError('owner-authority-required')
}

function toRoleGrant(grant: typeof organizationRoleGrants.$inferSelect) {
  return {
    grantId: grant.grantId,
    organizationVersion: grant.organizationVersion,
    userId: grant.userId,
    role: grant.role,
    reason: grant.reason,
    grantedByUserId: grant.grantedByUserId,
    grantedAt: grant.grantedAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    revokedByUserId: grant.revokedByUserId,
    revocationReason: grant.revocationReason,
  }
}
