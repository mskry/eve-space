import { and, eq, inArray } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import {
  deploymentSettings,
  organizationAllianceExecutorObservations,
  organizationGroupRuleReconciliation,
  organizationGroupRules,
} from '../db/schema.js'
import { appendDomainEvent } from '../domain-events/store.js'

export const convergeAllianceExecutorChangeInTransaction = async (
  transaction: DatabaseTransaction,
  observation: typeof organizationAllianceExecutorObservations.$inferSelect,
) => {
  const [settings] = await transaction
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (
    settings?.organizationVersion !== observation.organizationVersion ||
    !observation.executorRevision
  ) {
    return
  }
  const affected = await transaction
    .select({ groupId: organizationGroupRules.groupId })
    .from(organizationGroupRules)
    .where(
      and(
        eq(organizationGroupRules.deploymentId, 1),
        eq(organizationGroupRules.organizationVersion, observation.organizationVersion),
        eq(organizationGroupRules.enabled, true),
        inArray(organizationGroupRules.conditionKind, ['director-audience', 'corporation-role']),
      ),
    )
  if (affected.length > 0) {
    await transaction
      .update(organizationGroupRuleReconciliation)
      .set({ completedAt: null, cursorUserId: null, updatedAt: new Date() })
      .where(
        and(
          eq(
            organizationGroupRuleReconciliation.organizationVersion,
            observation.organizationVersion,
          ),
          inArray(
            organizationGroupRuleReconciliation.groupId,
            affected.map(({ groupId }) => groupId),
          ),
        ),
      )
  }
  await appendDomainEvent(transaction, {
    aggregateId: '1',
    payload: {
      organizationVersion: observation.organizationVersion,
      executorRevision: observation.executorRevision,
    },
    payloadVersion: 1,
    type: 'organization.alliance-executor-changed',
  })
}
