import { corporationRoleCooldownActive } from '../characters/corporation-role-observation.js'
import {
  selectDueCorporationRoleDemand,
  type CorporationRoleDemand,
  type CorporationRoleDemandCursor,
} from '../organization/corporation-role-demand.js'
import { env } from '../env.js'
import type { QueuePlanningContext } from './planning-context.js'
import { corporationRoleRefreshLeadMilliseconds } from './policy.js'

const enqueueDueRoleDemands = async (
  due: readonly CorporationRoleDemand[],
  context: QueuePlanningContext,
  now: Date,
) => {
  const { producer, signal } = context
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
    if (admission.status === 'accepted') {
      planned += 1
      continue
    }
    if (admission.reason !== 'coalesced') {
      return { planned, reason: admission.reason }
    }
  }
  return { planned, reason: null }
}

export const runCorporationRolePlanner = async (
  context: QueuePlanningContext,
  now = new Date(),
) => {
  const { signal } = context
  signal?.throwIfAborted()
  if (await corporationRoleCooldownActive()) {
    return { planned: 0, reason: 'cooldown' as const }
  }
  const dueBefore = new Date(now.getTime() + corporationRoleRefreshLeadMilliseconds)
  const pageSize = env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE
  let planned = 0
  let after: CorporationRoleDemandCursor | undefined
  while (planned < pageSize) {
    signal?.throwIfAborted()
    const limit = pageSize - planned
    // oxlint-disable-next-line no-await-in-loop -- each page advances past coalesced demand.
    const due = await selectDueCorporationRoleDemand({
      dueBefore,
      limit,
      ...(after && { after }),
    })
    signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- admission determines the next page's capacity.
    const page = await enqueueDueRoleDemands(due, context, now)
    planned += page.planned
    if (page.reason) {
      return { planned, reason: page.reason }
    }
    if (due.length < limit) {
      break
    }
    const last = due.at(-1)!
    after = { characterId: last.characterId, nextRefreshAt: last.nextRefreshAt }
  }
  return { planned, reason: planned === 0 ? ('idle' as const) : ('scheduled' as const) }
}
