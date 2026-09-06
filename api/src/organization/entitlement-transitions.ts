import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import {
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationMemberBlocks,
  organizationPermissionBundleEntries,
} from '../db/schema.js'
import { appendOrganizationAuditEvents } from './audit.js'

export async function appendExternalServiceEntitlementTransitions(
  transaction: DatabaseTransaction,
  input: {
    organizationVersion: number
    policyVersion: number
    userId: string
    granted: boolean
    causationAuditId: string
    now: Date
    reason: string
    permissionScope: 'all' | 'review' | 'non-review'
    ignoreBlock?: boolean
  },
) {
  if (!input.ignoreBlock) {
    const [block] = await transaction
      .select({ blockId: organizationMemberBlocks.blockId })
      .from(organizationMemberBlocks)
      .where(
        and(
          eq(organizationMemberBlocks.deploymentId, 1),
          eq(organizationMemberBlocks.organizationVersion, input.organizationVersion),
          eq(organizationMemberBlocks.userId, input.userId),
          isNull(organizationMemberBlocks.unblockedAt),
        ),
      )
      .limit(1)
    if (block) return
  }
  const serviceEntries = await transaction
    .selectDistinct({
      permissionKey: organizationPermissionBundleEntries.permissionKey,
      reviewAllowed: organizationPermissionBundleEntries.reviewAllowed,
    })
    .from(organizationGroupAssignments)
    .innerJoin(
      organizationGroupPermissionBundles,
      and(
        eq(organizationGroupPermissionBundles.groupId, organizationGroupAssignments.groupId),
        eq(
          organizationGroupPermissionBundles.organizationVersion,
          organizationGroupAssignments.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      organizationPermissionBundleEntries,
      eq(organizationPermissionBundleEntries.bundleId, organizationGroupPermissionBundles.bundleId),
    )
    .where(
      and(
        eq(organizationGroupAssignments.deploymentId, 1),
        eq(organizationGroupAssignments.organizationVersion, input.organizationVersion),
        eq(organizationGroupAssignments.userId, input.userId),
        isNull(organizationGroupAssignments.revokedAt),
        or(
          isNull(organizationGroupAssignments.expiresAt),
          gt(organizationGroupAssignments.expiresAt, input.now),
        ),
        eq(organizationPermissionBundleEntries.permissionType, 'service'),
      ),
    )
    .orderBy(asc(organizationPermissionBundleEntries.permissionKey))
  const reviewAccessByService = new Map<string, boolean>()
  for (const { permissionKey, reviewAllowed } of serviceEntries)
    reviewAccessByService.set(
      permissionKey,
      Boolean(reviewAccessByService.get(permissionKey) || reviewAllowed),
    )
  const services = [...reviewAccessByService]
    .filter(
      ([, reviewAllowed]) =>
        input.permissionScope === 'all' ||
        (input.permissionScope === 'review' && reviewAllowed) ||
        (input.permissionScope === 'non-review' && !reviewAllowed),
    )
    .map(([permissionKey]) => permissionKey)
  await appendOrganizationAuditEvents(
    transaction,
    services.map((permissionKey) => ({
      deploymentId: 1 as const,
      organizationVersion: input.organizationVersion,
      policyVersion: input.policyVersion,
      eventType: input.granted
        ? ('entitlement.granted' as const)
        : ('entitlement.revoked' as const),
      actorType: 'system' as const,
      actorId: null,
      subjectType: 'external_service' as const,
      subjectId: permissionKey,
      reason: input.reason,
      outcome: input.granted ? ('granted' as const) : ('revoked' as const),
      causationAuditId: input.causationAuditId,
      occurredAt: input.now,
    })),
  )
}
