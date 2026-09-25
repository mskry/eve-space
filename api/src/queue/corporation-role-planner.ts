import { corporationRoleCooldownActive } from '../characters/corporation-role-observation.js'
import { selectDueCorporationRoleDemand } from '../organization/corporation-role-demand.js'
import { env } from '../env.js'
import type { QueuePlanningContext } from './planning-context.js'
import { corporationRoleRefreshLeadMilliseconds } from './policy.js'

export async function runCorporationRolePlanner(context: QueuePlanningContext, now = new Date()) {
  const { producer, signal } = context
  signal?.throwIfAborted()
  if (await corporationRoleCooldownActive()) {
    return { planned: 0, reason: 'cooldown' as const }
  }
  const due = await selectDueCorporationRoleDemand({
    dueBefore: new Date(now.getTime() + corporationRoleRefreshLeadMilliseconds),
    limit: env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE,
  })
  signal?.throwIfAborted()
  let planned = 0
  for (const demand of due) {
    signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- admission depth changes per command.
    const admission = await producer.enqueue(
      {
        name: 'corporation-role-observation',
        notBefore: demand.nextRefreshAt ?? now,
        payload: {
          affiliationPeriodRevision: demand.affiliationPeriodRevision,
          authorityCorporationId: demand.authorityCorporationId,
          authorizationGeneration: demand.authorizationGeneration,
          characterId: demand.characterId,
          expectedRoleRevision: demand.expectedRoleRevision,
          organizationVersion: demand.organizationVersion,
          subjectLifecycleId: demand.subjectLifecycleId,
          userId: demand.userId,
        },
        source: 'planner',
      },
      { signal },
    )
    if (admission.status === 'rejected') {
      if (admission.reason === 'coalesced') {
        continue
      }
      return { planned, reason: admission.reason }
    }
    planned += 1
  }
  return { planned, reason: planned === 0 ? ('idle' as const) : ('scheduled' as const) }
}
