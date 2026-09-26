import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deploymentSettings, organizationAllianceExecutorObservations } from '../db/schema.js'
import { runRuleGroupReconciliation } from './group-rule-repair.js'

export const repairAllianceExecutorRuleGroups = async (input: {
  readonly organizationVersion: number
  readonly executorRevision: string
  readonly signal?: AbortSignal
}) => {
  input.signal?.throwIfAborted()
  const [current] = await db
    .select({ executorRevision: organizationAllianceExecutorObservations.executorRevision })
    .from(organizationAllianceExecutorObservations)
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, 1),
        eq(
          deploymentSettings.organizationVersion,
          organizationAllianceExecutorObservations.organizationVersion,
        ),
      ),
    )
    .where(
      and(
        eq(organizationAllianceExecutorObservations.organizationVersion, input.organizationVersion),
        eq(organizationAllianceExecutorObservations.executorRevision, input.executorRevision),
      ),
    )
  if (!current) {
    return
  }
  const due = await db.execute<{ groupId: string; revision: string }>(sql`
    select group_id as "groupId", revision::text as "revision"
    from organization_group_rule_reconciliation
    where organization_version = ${input.organizationVersion}
      and completed_at is null
    order by group_id asc limit 10
  `)
  for (const group of due) {
    input.signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Each bounded group repair follows current revision checks.
    await runRuleGroupReconciliation({
      groupId: group.groupId,
      organizationVersion: input.organizationVersion,
      revision: Number(group.revision),
      signal: input.signal,
    })
  }
}
