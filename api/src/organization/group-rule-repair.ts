import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { env } from '../env.js'
import {
  deploymentSettings,
  organizationGroupRuleReconciliation,
  organizationGroupRules,
} from '../db/schema.js'
import { convergeRuleManagedGroupForAccountInTransaction } from './group-rule-convergence.js'
import { lockCurrentOrganization } from './organization-lock.js'

const rescanMilliseconds = 15 * 60_000
const accountPageSize = 50

export const selectDueRuleReconciliation = async (now = new Date(), limit = 10) =>
  db
    .select({
      groupId: organizationGroupRuleReconciliation.groupId,
      organizationVersion: organizationGroupRuleReconciliation.organizationVersion,
      revision: organizationGroupRuleReconciliation.revision,
    })
    .from(organizationGroupRuleReconciliation)
    .innerJoin(
      organizationGroupRules,
      and(
        eq(organizationGroupRules.groupId, organizationGroupRuleReconciliation.groupId),
        eq(organizationGroupRules.revision, organizationGroupRuleReconciliation.revision),
      ),
    )
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, 1),
        eq(
          deploymentSettings.organizationVersion,
          organizationGroupRuleReconciliation.organizationVersion,
        ),
      ),
    )
    .where(
      or(
        isNull(organizationGroupRuleReconciliation.completedAt),
        lt(
          organizationGroupRuleReconciliation.completedAt,
          new Date(now.getTime() - rescanMilliseconds),
        ),
      ),
    )
    .orderBy(asc(organizationGroupRuleReconciliation.groupId))
    .limit(Math.max(1, limit))

export const runRuleGroupReconciliation = async (input: {
  readonly groupId: string
  readonly organizationVersion: number
  readonly revision: number
  readonly signal?: AbortSignal
  readonly now?: Date
}) => {
  const now = input.now ?? new Date()
  const pageSize = Math.min(accountPageSize, env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE)
  for (let processed = 0; processed < pageSize; processed += 1) {
    input.signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- each committed cursor follows one account decision.
    const outcome = await db.transaction(async (transaction) => {
      const organization = await lockCurrentOrganization(transaction)
      if (organization.organizationVersion !== input.organizationVersion) {
        return 'obsolete' as const
      }
      const [progress] = await transaction
        .select()
        .from(organizationGroupRuleReconciliation)
        .where(
          and(
            eq(organizationGroupRuleReconciliation.groupId, input.groupId),
            eq(organizationGroupRuleReconciliation.revision, input.revision),
          ),
        )
        .for('update')
      if (!progress) {
        return 'obsolete' as const
      }
      const rescan =
        progress.completedAt && progress.completedAt.getTime() + rescanMilliseconds <= now.getTime()
      if (progress.completedAt && !rescan) {
        return 'idle' as const
      }
      const cursor = rescan ? null : progress.cursorUserId
      const [candidate] = await transaction.execute<{ userId: string }>(sql`
        select account.user_id as "userId" from (
          select user_id from organization_account_compliance
            where deployment_id = 1 and organization_version = ${input.organizationVersion}
          union
          select user_id from organization_group_assignments
            where deployment_id = 1 and organization_version = ${input.organizationVersion}
              and group_id = ${input.groupId}::uuid
        ) account
        where ${cursor}::uuid is null or account.user_id > ${cursor}::uuid
        order by account.user_id asc
        limit 1
      `)
      if (!candidate) {
        await transaction
          .update(organizationGroupRuleReconciliation)
          .set({ completedAt: now, cursorUserId: cursor, updatedAt: now })
          .where(eq(organizationGroupRuleReconciliation.groupId, input.groupId))
        return 'complete' as const
      }
      await convergeRuleManagedGroupForAccountInTransaction(
        transaction,
        organization,
        input.groupId,
        candidate.userId,
        now,
      )
      await transaction
        .update(organizationGroupRuleReconciliation)
        .set({ completedAt: null, cursorUserId: candidate.userId, updatedAt: now })
        .where(eq(organizationGroupRuleReconciliation.groupId, input.groupId))
      return 'processed' as const
    })
    if (outcome !== 'processed') {
      return outcome
    }
  }
  return 'page-complete' as const
}
