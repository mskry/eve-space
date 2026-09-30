import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deploymentSettings,
  organizationAccountCompliance,
  organizationMemberBlocks,
} from '../db/schema.js'
import { isComplianceProjectionDue, type OrganizationSessionContext } from './access-policy.js'
import { recomputeOrganizationAccountCompliance } from './compliance.js'

const selectOrganizationSessionContext = async (
  userId: string,
): Promise<{ context: OrganizationSessionContext; projected: boolean }> => {
  const [organization] = await db
    .select({
      accessValidUntil: organizationAccountCompliance.accessValidUntil,
      evidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      organizationVersion: deploymentSettings.organizationVersion,
      projectedUserId: organizationAccountCompliance.userId,
      reviewDeadline: organizationAccountCompliance.reviewDeadline,
      state: organizationAccountCompliance.state,
    })
    .from(deploymentSettings)
    .leftJoin(
      organizationAccountCompliance,
      and(
        eq(organizationAccountCompliance.deploymentId, deploymentSettings.id),
        eq(
          organizationAccountCompliance.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationAccountCompliance.userId, userId),
        eq(organizationAccountCompliance.authoritative, true),
      ),
    )
    .where(eq(deploymentSettings.id, 1))
  if (!organization) throw new Error('Deployment organization is not configured')
  const [block] = await db
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
  return {
    context: {
      accessValidUntil: organization.accessValidUntil,
      blocked: Boolean(block),
      evidenceFreshness: organization.evidenceFreshness ?? 'unavailable',
      organizationVersion: organization.organizationVersion,
      reviewDeadline: organization.reviewDeadline,
      state: organization.state ?? 'pending',
    },
    projected: Boolean(organization.projectedUserId),
  }
}

export const loadOrganizationSessionContext = async (
  userId: string,
): Promise<OrganizationSessionContext> => {
  let selected = await selectOrganizationSessionContext(userId)
  const now = new Date()
  if (!selected.projected || isComplianceProjectionDue(selected.context, now)) {
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      now,
      organizationVersion: selected.context.organizationVersion,
      userId,
    })
    selected = await selectOrganizationSessionContext(userId)
  }
  return selected.context
}
