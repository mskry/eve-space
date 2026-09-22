import { and, eq, isNull } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import { organizationMemberBlocks } from '../db/schema.js'

type Database = DatabaseTransaction | typeof db

export async function hasActiveOrganizationMemberBlock(
  database: Database,
  organizationVersion: number,
  userId: string,
) {
  const [block] = await database
    .select({ blockId: organizationMemberBlocks.blockId })
    .from(organizationMemberBlocks)
    .where(
      and(
        eq(organizationMemberBlocks.deploymentId, 1),
        eq(organizationMemberBlocks.organizationVersion, organizationVersion),
        eq(organizationMemberBlocks.userId, userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .limit(1)
  return Boolean(block)
}
