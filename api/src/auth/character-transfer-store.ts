import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import {
  organizationCharacterExceptions,
  organizationCorporationSources,
  organizationGroupAssignments,
  organizationGroups,
  organizationMemberBlocks,
  organizationPermissionBundles,
  organizationRoleGrants,
  users,
} from '../db/schema.js'

export async function lockTransferUsers(
  transaction: DatabaseTransaction,
  userIds: readonly string[],
) {
  const ordered = [...new Set(userIds)].toSorted((left, right) => left.localeCompare(right))
  const locked = await transaction
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, ordered))
    .orderBy(asc(users.id))
    .for('update')
  return locked.length === ordered.length
}

export async function loadDatabaseWallClock(transaction: DatabaseTransaction) {
  const [record] = await transaction
    .select({ now: sql<string>`clock_timestamp()` })
    .from(sql`(select 1) as database_clock`)
  if (!record) throw new Error('Database clock is unavailable')
  return new Date(record.now)
}

export async function deleteEmptyTransferSourceUser(
  transaction: DatabaseTransaction,
  userId: string,
) {
  if (await hasRetainedUserDependency(transaction, userId)) return false
  try {
    return await transaction.transaction(async (savepoint) => {
      const [deleted] = await savepoint
        .delete(users)
        .where(eq(users.id, userId))
        .returning({ id: users.id })
      return Boolean(deleted)
    })
  } catch (error) {
    if (hasPostgresErrorCode(error, '23503')) return false
    throw error
  }
}

async function hasRetainedUserDependency(transaction: DatabaseTransaction, userId: string) {
  const [record] = await transaction
    .select({
      retained: sql<boolean>`
        exists (
          select 1 from ${organizationRoleGrants}
          where ${organizationRoleGrants.userId} = ${userId}
            or ${organizationRoleGrants.grantedByUserId} = ${userId}
            or ${organizationRoleGrants.revokedByUserId} = ${userId}
        )
        or exists (
          select 1 from ${organizationGroupAssignments}
          where (${organizationGroupAssignments.userId} = ${userId}
              and ${organizationGroupAssignments.assignmentSource} = 'manual')
            or ${organizationGroupAssignments.assignedByUserId} = ${userId}
            or ${organizationGroupAssignments.revokedByUserId} = ${userId}
        )
        or exists (
          select 1 from ${organizationMemberBlocks}
          where ${organizationMemberBlocks.userId} = ${userId}
            or ${organizationMemberBlocks.blockedByUserId} = ${userId}
            or ${organizationMemberBlocks.unblockedByUserId} = ${userId}
        )
        or exists (
          select 1 from ${organizationCharacterExceptions}
          where ${organizationCharacterExceptions.approverUserId} = ${userId}
            or ${organizationCharacterExceptions.revokedByUserId} = ${userId}
        )
        or exists (
          select 1 from ${organizationCorporationSources}
          where ${organizationCorporationSources.registeredByUserId} = ${userId}
            or ${organizationCorporationSources.revokedByUserId} = ${userId}
        )
        or exists (
          select 1 from ${organizationGroups}
          where ${organizationGroups.createdByUserId} = ${userId}
        )
        or exists (
          select 1 from ${organizationPermissionBundles}
          where ${organizationPermissionBundles.createdByUserId} = ${userId}
        )
      `,
    })
    .from(users)
    .where(eq(users.id, userId))
  return record?.retained ?? true
}

function hasPostgresErrorCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object') return false
  if ('code' in error && error.code === code) return true
  return 'cause' in error && hasPostgresErrorCode(error.cause, code)
}
