import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deploymentSettings,
  organizationMemberBlocks,
  organizationRoleGrants,
  users,
} from '../db/schema.js'
import { appendOrganizationAuditEvent } from './audit.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { loadCurrentEntitlementScope } from './compliance-access.js'
import { appendExternalServiceEntitlementTransitions } from './compliance.js'
import { loadManagementAuthority } from './group-store.js'

export class OrganizationMemberBlockMutationError extends Error {
  constructor(
    readonly code:
      | 'manager-authority-required'
      | 'target-not-found'
      | 'self-block-not-allowed'
      | 'owner-block-not-allowed'
      | 'block-already-active'
      | 'block-not-found',
  ) {
    super(code)
  }
}

export async function hasCurrentOrganizationMemberBlock(userId: string) {
  const [block] = await db
    .select({ blockId: organizationMemberBlocks.blockId })
    .from(deploymentSettings)
    .innerJoin(
      organizationMemberBlocks,
      and(
        eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
        eq(organizationMemberBlocks.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(organizationMemberBlocks.userId, userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .limit(1)
  return Boolean(block)
}

export async function blockOrganizationMember(input: {
  actorUserId: string
  targetUserId: string
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireManager(transaction, organization.organizationVersion, input.actorUserId)
    if (input.actorUserId === input.targetUserId)
      throw new OrganizationMemberBlockMutationError('self-block-not-allowed')
    await requireTarget(transaction, input.targetUserId)
    const [owner] = await transaction
      .select({ grantId: organizationRoleGrants.grantId })
      .from(organizationRoleGrants)
      .where(
        and(
          eq(organizationRoleGrants.deploymentId, 1),
          eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
          eq(organizationRoleGrants.userId, input.targetUserId),
          eq(organizationRoleGrants.role, 'organization_owner'),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
      .limit(1)
    if (owner) throw new OrganizationMemberBlockMutationError('owner-block-not-allowed')

    const [existing] = await transaction
      .select({ blockId: organizationMemberBlocks.blockId })
      .from(organizationMemberBlocks)
      .where(
        and(
          eq(organizationMemberBlocks.deploymentId, 1),
          eq(organizationMemberBlocks.organizationVersion, organization.organizationVersion),
          eq(organizationMemberBlocks.userId, input.targetUserId),
          isNull(organizationMemberBlocks.unblockedAt),
        ),
      )
      .for('update')
    if (existing) throw new OrganizationMemberBlockMutationError('block-already-active')

    const now = new Date()
    const targetEntitlementScope = await loadCurrentEntitlementScope(
      transaction,
      organization.organizationVersion,
      input.targetUserId,
      now,
    )
    const [block] = await transaction
      .insert(organizationMemberBlocks)
      .values({
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        userId: input.targetUserId,
        blockedByUserId: input.actorUserId,
        reason: input.reason,
        blockedAt: now,
      })
      .returning()
    if (!block) throw new Error('Failed to block organization member')
    const blockAudit = await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: organization.organizationVersion,
      policyVersion: organization.policyVersion,
      eventType: 'member.blocked',
      actorType: 'user',
      actorId: input.actorUserId,
      subjectType: 'user',
      subjectId: input.targetUserId,
      reason: input.reason,
      outcome: 'denied',
      occurredAt: now,
    })
    if (targetEntitlementScope !== 'none')
      await appendExternalServiceEntitlementTransitions(transaction, {
        organizationVersion: organization.organizationVersion,
        policyVersion: organization.policyVersion,
        userId: input.targetUserId,
        granted: false,
        causationAuditId: blockAudit.auditId,
        now,
        reason: 'A member block revoked this external-service entitlement.',
        permissionScope: targetEntitlementScope,
        ignoreBlock: true,
      })
    await appendDomainEvent(transaction, {
      type: 'organization.member-blocked',
      payloadVersion: 1,
      aggregateId: input.targetUserId,
      payload: {
        organizationVersion: organization.organizationVersion,
        userId: input.targetUserId,
        blockId: block.blockId,
      },
      occurredAt: now,
    })
    return toMemberBlock(block)
  })
}

export async function unblockOrganizationMember(input: {
  actorUserId: string
  targetUserId: string
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireManager(transaction, organization.organizationVersion, input.actorUserId)
    const [block] = await transaction
      .select()
      .from(organizationMemberBlocks)
      .where(
        and(
          eq(organizationMemberBlocks.deploymentId, 1),
          eq(organizationMemberBlocks.organizationVersion, organization.organizationVersion),
          eq(organizationMemberBlocks.userId, input.targetUserId),
          isNull(organizationMemberBlocks.unblockedAt),
        ),
      )
      .for('update')
    if (!block) throw new OrganizationMemberBlockMutationError('block-not-found')

    const now = new Date()
    const [unblocked] = await transaction
      .update(organizationMemberBlocks)
      .set({
        unblockedAt: now,
        unblockedByUserId: input.actorUserId,
        unblockReason: input.reason,
        updatedAt: now,
      })
      .where(eq(organizationMemberBlocks.blockId, block.blockId))
      .returning()
    if (!unblocked) throw new Error('Failed to unblock organization member')
    const unblockAudit = await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: organization.organizationVersion,
      policyVersion: organization.policyVersion,
      eventType: 'member.unblocked',
      actorType: 'user',
      actorId: input.actorUserId,
      subjectType: 'user',
      subjectId: input.targetUserId,
      reason: input.reason,
      outcome: 'transitioned',
      occurredAt: now,
    })
    const targetEntitlementScope = await loadCurrentEntitlementScope(
      transaction,
      organization.organizationVersion,
      input.targetUserId,
      now,
    )
    if (targetEntitlementScope !== 'none')
      await appendExternalServiceEntitlementTransitions(transaction, {
        organizationVersion: organization.organizationVersion,
        policyVersion: organization.policyVersion,
        userId: input.targetUserId,
        granted: true,
        causationAuditId: unblockAudit.auditId,
        now,
        reason: 'Removing the member block restored this external-service entitlement.',
        permissionScope: targetEntitlementScope,
      })
    await appendDomainEvent(transaction, {
      type: 'organization.member-unblocked',
      payloadVersion: 1,
      aggregateId: input.targetUserId,
      payload: {
        organizationVersion: organization.organizationVersion,
        userId: input.targetUserId,
        blockId: unblocked.blockId,
      },
      occurredAt: now,
    })
    return toMemberBlock(unblocked)
  })
}

export async function listCurrentOrganizationMemberBlocks() {
  const blocks = await db
    .select()
    .from(deploymentSettings)
    .innerJoin(
      organizationMemberBlocks,
      and(
        eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
        eq(organizationMemberBlocks.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .where(and(eq(deploymentSettings.id, 1), isNull(organizationMemberBlocks.unblockedAt)))
  return { blocks: blocks.map(({ organization_member_blocks: block }) => toMemberBlock(block)) }
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

async function requireManager(
  transaction: Transaction,
  organizationVersion: number,
  userId: string,
) {
  if (!(await loadManagementAuthority(transaction, organizationVersion, userId)))
    throw new OrganizationMemberBlockMutationError('manager-authority-required')
}

async function requireTarget(transaction: Transaction, userId: string) {
  const [target] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
  if (!target) throw new OrganizationMemberBlockMutationError('target-not-found')
}

function toMemberBlock(block: typeof organizationMemberBlocks.$inferSelect) {
  return {
    blockId: block.blockId,
    organizationVersion: block.organizationVersion,
    userId: block.userId,
    blockedByUserId: block.blockedByUserId,
    reason: block.reason,
    blockedAt: block.blockedAt.toISOString(),
    unblockedAt: block.unblockedAt?.toISOString() ?? null,
    unblockedByUserId: block.unblockedByUserId,
    unblockReason: block.unblockReason,
  }
}
