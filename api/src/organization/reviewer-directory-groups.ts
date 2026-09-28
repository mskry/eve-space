import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import { organizationGroupAssignments, organizationGroups } from '../db/schema.js'

export const loadDirectoryGroupData = async (
  transaction: DatabaseTransaction,
  organizationVersion: number,
  userIds: readonly string[],
  now: Date,
) => {
  const rows = await transaction
    .select({
      groupId: organizationGroups.groupId,
      name: organizationGroups.name,
      userId: organizationGroupAssignments.userId,
    })
    .from(organizationGroups)
    .leftJoin(
      organizationGroupAssignments,
      and(
        eq(organizationGroups.groupId, organizationGroupAssignments.groupId),
        eq(organizationGroups.deploymentId, organizationGroupAssignments.deploymentId),
        eq(
          organizationGroups.organizationVersion,
          organizationGroupAssignments.organizationVersion,
        ),
        userIds.length > 0
          ? inArray(organizationGroupAssignments.userId, [...userIds])
          : sql`false`,
        isNull(organizationGroupAssignments.revokedAt),
        or(
          isNull(organizationGroupAssignments.expiresAt),
          gt(organizationGroupAssignments.expiresAt, now),
        ),
      ),
    )
    .where(
      and(
        eq(organizationGroups.deploymentId, 1),
        eq(organizationGroups.organizationVersion, organizationVersion),
      ),
    )
    .orderBy(
      asc(organizationGroups.name),
      asc(organizationGroups.groupId),
      asc(organizationGroupAssignments.userId),
      asc(organizationGroupAssignments.assignmentId),
    )
  const facets: { groupId: string; name: string }[] = []
  const groupsByUserId = new Map<string, { groupId: string; name: string }[]>()
  for (const row of rows) {
    if (!facets.some(({ groupId }) => groupId === row.groupId)) {
      facets.push({ groupId: row.groupId, name: row.name })
    }
    if (!row.userId) continue
    const groups = groupsByUserId.get(row.userId) ?? []
    if (!groups.some(({ groupId }) => groupId === row.groupId)) {
      groups.push({ groupId: row.groupId, name: row.name })
    }
    groupsByUserId.set(row.userId, groups)
  }
  return { facets, groupsByUserId }
}
