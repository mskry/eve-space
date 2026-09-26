import { and, eq, isNull } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  deploymentSettings,
  characters,
  organizationMemberBlocks,
  organizationRoleGrants,
  users,
} from '../db/schema.js'
import { appendOrganizationAuditEvent } from './audit.js'
import { invalidateCharacterAuthoritySourcesInTransaction } from './authority-convergence.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { loadCurrentEntitlementScope } from './compliance-access.js'
import { appendExternalServiceEntitlementTransitions } from './entitlement-transitions.js'
import { loadManagementAuthority } from './management-authority.js'
import { lockCurrentOrganization } from './organization-lock.js'
import { convergeRuleManagedGroupsForAccountInTransaction } from './group-rule-convergence.js'

type Transaction = DatabaseTransaction

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
    return blockOrganizationMemberInTransaction(transaction, organization, input)
  })
}

export async function blockOrganizationMemberInTransaction(
  transaction: Transaction,
  organization: { organizationVersion: number; policyVersion: number },
  input: { actorUserId: string; targetUserId: string; reason: string },
) {
  if (input.actorUserId === input.targetUserId) {
    throw new OrganizationMemberBlockMutationError('self-block-not-allowed')
  }
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
  if (owner) {
    throw new OrganizationMemberBlockMutationError('owner-block-not-allowed')
  }

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
  if (existing) {
    throw new OrganizationMemberBlockMutationError('block-already-active')
  }

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
      blockedAt: now,
      blockedByUserId: input.actorUserId,
      deploymentId: 1,
      organizationVersion: organization.organizationVersion,
      reason: input.reason,
      userId: input.targetUserId,
    })
    .returning()
  if (!block) {
    throw new Error('Failed to block organization member')
  }
  const blockAudit = await appendOrganizationAuditEvent(transaction, {
    actorId: input.actorUserId,
    actorType: 'user',
    deploymentId: 1,
    eventType: 'member.blocked',
    occurredAt: now,
    organizationVersion: organization.organizationVersion,
    outcome: 'denied',
    policyVersion: organization.policyVersion,
    reason: input.reason,
    subjectId: input.targetUserId,
    subjectType: 'user',
  })
  if (targetEntitlementScope !== 'none') {
    await appendExternalServiceEntitlementTransitions(transaction, {
      causationAuditId: blockAudit.auditId,
      granted: false,
      ignoreBlock: true,
      now,
      organizationVersion: organization.organizationVersion,
      permissionScope: targetEntitlementScope,
      policyVersion: organization.policyVersion,
      reason: 'A member block revoked this external-service entitlement.',
      userId: input.targetUserId,
    })
  }
  await convergeRuleManagedGroupsForAccountInTransaction(
    transaction,
    organization,
    input.targetUserId,
    now,
  )
  const targetCharacters = await transaction
    .select({ characterId: characters.characterId })
    .from(characters)
    .where(eq(characters.userId, input.targetUserId))
  for (const { characterId } of targetCharacters) {
    // oxlint-disable-next-line no-await-in-loop
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId,
      now,
      outcome: 'blocked',
    })
  }
  await appendDomainEvent(transaction, {
    aggregateId: input.targetUserId,
    occurredAt: now,
    payload: {
      blockId: block.blockId,
      organizationVersion: organization.organizationVersion,
      userId: input.targetUserId,
    },
    payloadVersion: 1,
    type: 'organization.member-blocked',
  })
  return toMemberBlock(block)
}

export async function unblockOrganizationMember(input: {
  actorUserId: string
  targetUserId: string
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireManager(transaction, organization.organizationVersion, input.actorUserId)
    return unblockOrganizationMemberInTransaction(transaction, organization, input)
  })
}

export async function unblockOrganizationMemberInTransaction(
  transaction: Transaction,
  organization: { organizationVersion: number; policyVersion: number },
  input: { actorUserId: string; targetUserId: string; reason: string },
) {
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
  if (!block) {
    throw new OrganizationMemberBlockMutationError('block-not-found')
  }

  const now = new Date()
  const [unblocked] = await transaction
    .update(organizationMemberBlocks)
    .set({
      unblockReason: input.reason,
      unblockedAt: now,
      unblockedByUserId: input.actorUserId,
      updatedAt: now,
    })
    .where(eq(organizationMemberBlocks.blockId, block.blockId))
    .returning()
  if (!unblocked) {
    throw new Error('Failed to unblock organization member')
  }
  const unblockAudit = await appendOrganizationAuditEvent(transaction, {
    actorId: input.actorUserId,
    actorType: 'user',
    deploymentId: 1,
    eventType: 'member.unblocked',
    occurredAt: now,
    organizationVersion: organization.organizationVersion,
    outcome: 'transitioned',
    policyVersion: organization.policyVersion,
    reason: input.reason,
    subjectId: input.targetUserId,
    subjectType: 'user',
  })
  const targetEntitlementScope = await loadCurrentEntitlementScope(
    transaction,
    organization.organizationVersion,
    input.targetUserId,
    now,
  )
  if (targetEntitlementScope !== 'none') {
    await appendExternalServiceEntitlementTransitions(transaction, {
      causationAuditId: unblockAudit.auditId,
      granted: true,
      now,
      organizationVersion: organization.organizationVersion,
      permissionScope: targetEntitlementScope,
      policyVersion: organization.policyVersion,
      reason: 'Removing the member block restored this external-service entitlement.',
      userId: input.targetUserId,
    })
  }
  await convergeRuleManagedGroupsForAccountInTransaction(
    transaction,
    organization,
    input.targetUserId,
    now,
  )
  await appendDomainEvent(transaction, {
    aggregateId: input.targetUserId,
    occurredAt: now,
    payload: {
      blockId: unblocked.blockId,
      organizationVersion: organization.organizationVersion,
      userId: input.targetUserId,
    },
    payloadVersion: 1,
    type: 'organization.member-unblocked',
  })
  return toMemberBlock(unblocked)
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

async function requireManager(
  transaction: Transaction,
  organizationVersion: number,
  userId: string,
) {
  if (
    !(await loadManagementAuthority(transaction, organizationVersion, userId, new Date(), 'mutate'))
  ) {
    throw new OrganizationMemberBlockMutationError('manager-authority-required')
  }
}

async function requireTarget(transaction: Transaction, userId: string) {
  const [target] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
  if (!target) {
    throw new OrganizationMemberBlockMutationError('target-not-found')
  }
}

function toMemberBlock(block: typeof organizationMemberBlocks.$inferSelect) {
  return {
    blockId: block.blockId,
    blockedAt: block.blockedAt.toISOString(),
    blockedByUserId: block.blockedByUserId,
    organizationVersion: block.organizationVersion,
    reason: block.reason,
    unblockReason: block.unblockReason,
    unblockedAt: block.unblockedAt?.toISOString() ?? null,
    unblockedByUserId: block.unblockedByUserId,
    userId: block.userId,
  }
}
