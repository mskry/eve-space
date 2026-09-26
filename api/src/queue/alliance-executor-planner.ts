import { selectDueAllianceExecutor } from '../organization/alliance-executor-evidence.js'
import type { QueuePlanningContext } from './planning-context.js'
import { corporationRoleRefreshLeadMilliseconds } from './policy.js'

export const runAllianceExecutorPlanner = async (
  context: QueuePlanningContext,
  now = new Date(),
) => {
  context.signal?.throwIfAborted()
  const due = await selectDueAllianceExecutor(
    undefined,
    new Date(now.getTime() + corporationRoleRefreshLeadMilliseconds),
  )
  if (!due) {
    return { planned: 0, reason: 'idle' as const }
  }
  const admission = await context.producer.enqueue(
    {
      name: 'alliance-executor-observation',
      notBefore: due.nextRefreshAt ?? now,
      payload: {
        expectedRevision: due.expectedRevision,
        organizationVersion: due.organizationVersion,
      },
      source: 'planner',
    },
    { signal: context.signal },
  )
  return {
    planned: Number(admission.status === 'accepted'),
    reason: admission.status === 'accepted' ? null : admission.reason,
  }
}
