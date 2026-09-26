import { selectDueRuleReconciliation } from '../organization/group-rule-repair.js'
import type { QueuePlanningContext } from './planning-context.js'

export const runGroupRulePlanner = async (context: QueuePlanningContext) => {
  context.signal?.throwIfAborted()
  const due = await selectDueRuleReconciliation()
  let planned = 0
  for (const rule of due) {
    context.signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- Capacity must be checked after each admission.
    const result = await context.producer.enqueue(
      {
        name: 'rule-group-reconciliation',
        payload: rule,
        source: 'planner',
      },
      { signal: context.signal },
    )
    if (result.status === 'accepted') {
      planned += 1
    } else if (result.reason !== 'coalesced') {
      return { planned, reason: result.reason }
    }
  }
  return { planned, reason: planned === 0 ? ('idle' as const) : ('scheduled' as const) }
}
