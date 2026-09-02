import { and, eq, isNull } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { db } from '../db/client.js'
import {
  deploymentSettings,
  organizationAccountCompliance,
  organizationMemberBlocks,
} from '../db/schema.js'
import type { SessionEnv } from './auth-session.js'
import { isComplianceProjectionDue } from '../organization/compliance-access.js'
import { recomputeOrganizationAccountCompliance } from '../organization/compliance.js'

export interface OrganizationSessionContext {
  organizationVersion: number
  state: 'pending' | 'compliant' | 'review_required' | 'suspended'
  evidenceFreshness: 'fresh' | 'stale' | 'unavailable'
  reviewDeadline: Date | null
  accessValidUntil: Date | null
  blocked: boolean
}

export type OrganizationSessionEnv = {
  Variables: SessionEnv['Variables'] & {
    organization: OrganizationSessionContext | null
  }
}

export const loadOrganizationSession = createMiddleware<OrganizationSessionEnv>(
  async (context, next) => {
    const session = context.var.session
    context.set(
      'organization',
      session ? await loadOrganizationSessionContext(session.userId) : null,
    )
    await next()
  },
)

export async function loadOrganizationSessionContext(
  userId: string,
): Promise<OrganizationSessionContext> {
  let selected = await selectOrganizationSessionContext(userId)
  const now = new Date()
  if (!selected.projected || isComplianceProjectionDue(selected.context, now)) {
    await recomputeOrganizationAccountCompliance({
      deploymentId: 1,
      organizationVersion: selected.context.organizationVersion,
      userId,
      now,
    })
    selected = await selectOrganizationSessionContext(userId)
  }
  return selected.context
}

async function selectOrganizationSessionContext(
  userId: string,
): Promise<{ context: OrganizationSessionContext; projected: boolean }> {
  const [organization] = await db
    .select({
      organizationVersion: deploymentSettings.organizationVersion,
      projectedUserId: organizationAccountCompliance.userId,
      state: organizationAccountCompliance.state,
      evidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      reviewDeadline: organizationAccountCompliance.reviewDeadline,
      accessValidUntil: organizationAccountCompliance.accessValidUntil,
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
      organizationVersion: organization.organizationVersion,
      state: organization.state ?? 'pending',
      evidenceFreshness: organization.evidenceFreshness ?? 'unavailable',
      reviewDeadline: organization.reviewDeadline,
      accessValidUntil: organization.accessValidUntil,
      blocked: Boolean(block),
    },
    projected: Boolean(organization.projectedUserId),
  }
}
