import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import { env } from '../env.js'
import { planInstalledProfileWork, type PlannedProfileWork } from '../platform/profile-work.js'
import { platformResources } from '../platform/resources.js'
import { selectDueInstalledResources } from '../platform/resource-eligibility.js'
import {
  createResourcePlanningCooldownRequest,
  getResourcePlanningCooldowns,
} from '../platform/resource-planning.js'
import type { QueuePlanningContext } from './planning-context.js'

const profileWorkLimit = 16

type DueResource = Awaited<ReturnType<typeof selectDueInstalledResources>>[number]
type PlannedEntry = {
  readonly entry: PlannedProfileWork
  readonly candidate: DueResource
  readonly resource: PlatformInstalledResourceDescriptor
}

const planDueResource = async (
  candidate: DueResource,
  resources: readonly PlatformInstalledResourceDescriptor[],
  plan: typeof planInstalledProfileWork,
  signal?: AbortSignal,
): Promise<PlannedEntry[]> => {
  const resource = resources.find(
    ({ moduleId, resourceId }) =>
      moduleId === candidate.identity.moduleId && resourceId === candidate.identity.resourceId,
  )
  if (!resource) throw new Error('Due profile work has no installed resource')
  const work = await plan(candidate.identity, new Date().toISOString(), profileWorkLimit, {
    resources,
    signal,
  })
  return work.map((entry) => ({ entry, candidate, resource }))
}

export const createProfileCommand = (
  work: PlannedProfileWork,
  resource: PlatformInstalledResourceDescriptor,
  source: 'planner' | 'on-demand' = 'planner',
) => ({
  name: 'module-profile-refresh' as const,
  payload: {
    ...work.resourceIdentity,
    profileId: work.profileId,
    revision: work.revision,
    dueAt: work.dueAt,
    requestedTypeId: work.requestedTypeId,
  },
  materializationIntervalSeconds: resource.materializationIntervalSeconds,
  source,
})

const comparePlannedEntries = (left: PlannedEntry, right: PlannedEntry) =>
  left.entry.dueAt.localeCompare(right.entry.dueAt) ||
  left.resource.moduleId.localeCompare(right.resource.moduleId) ||
  left.resource.resourceId.localeCompare(right.resource.resourceId) ||
  left.entry.profileId.localeCompare(right.entry.profileId)

const summarizeProfileAdmission = (
  results: Awaited<ReturnType<QueuePlanningContext['producer']['enqueueMany']>>,
  firstCooldown: number,
  selected: number,
  attempted: number,
) => {
  const planned = results.filter(({ status }) => status === 'accepted').length
  if (
    results.some((result) => result.status === 'rejected' && result.reason === 'planner-paused')
  ) {
    return { planned, selected, reason: 'capacity' as const }
  }
  if (firstCooldown !== -1) return { planned, selected, reason: 'cooldown' as const }
  return {
    planned,
    selected,
    reason: selected > attempted ? ('capacity' as const) : ('scheduled' as const),
  }
}

export const runProfileWorkPlanner = async (
  context: QueuePlanningContext,
  options: {
    readonly resources?: readonly PlatformInstalledResourceDescriptor[]
    readonly selectDue?: typeof selectDueInstalledResources
    readonly plan?: typeof planInstalledProfileWork
    readonly cooldowns?: typeof getResourcePlanningCooldowns
  } = {},
) => {
  const { producer, signal } = context
  signal?.throwIfAborted()
  const resources = (options.resources ?? platformResources).filter(
    (resource) => resource.profileKeyed === true,
  )
  if (resources.length === 0) return { planned: 0, selected: 0, reason: 'idle' as const }
  const admission = await producer.inspectCapacity({
    highWaterMark: env.QUEUE_HIGH_WATER_MARK,
    preservePausedState: true,
    source: 'planner',
  })
  if (admission.status === 'rejected' || admission.remainingCapacity === 0) {
    return { planned: 0, selected: 0, reason: 'capacity' as const }
  }
  const due = await (options.selectDue ?? selectDueInstalledResources)({
    includeProfileKeyed: true,
    limit: Math.min(resources.length, env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE),
    resources,
    signal,
  })
  const planned = await Promise.all(
    due.map((candidate) =>
      planDueResource(candidate, resources, options.plan ?? planInstalledProfileWork, signal),
    ),
  )
  const ordered = planned.flat().toSorted(comparePlannedEntries)
  const prefix = ordered.slice(0, Math.min(profileWorkLimit, admission.remainingCapacity))
  const upstream = prefix.filter(({ entry }) => entry.localWorkPending !== true)
  const cooldowns = await (options.cooldowns ?? getResourcePlanningCooldowns)(
    upstream.map(({ candidate, resource }) =>
      createResourcePlanningCooldownRequest(candidate, resource),
    ),
  )
  signal?.throwIfAborted()
  if (cooldowns.length !== upstream.length) throw new Error('Profile cooldown batch is incomplete')
  const cooled = new Set(upstream.filter((_, index) => cooldowns[index]!.active))
  const firstCooldown = prefix.findIndex((entry) => cooled.has(entry))
  const admitted = prefix.filter(
    ({ entry }, index) =>
      firstCooldown === -1 || index < firstCooldown || entry.localWorkPending === true,
  )
  const results = await producer.enqueueMany(
    admitted.map(({ entry, resource }) => createProfileCommand(entry, resource)),
    { preservePausedState: true, signal },
  )
  return summarizeProfileAdmission(results, firstCooldown, ordered.length, prefix.length)
}
