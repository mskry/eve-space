import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { env } from '../env.js'
import { platformResources } from '../platform/resources.js'
import {
  selectDueInstalledResources,
  type DueInstalledResource,
} from '../platform/resource-eligibility.js'
import {
  findInstalledResource,
  installedResourceIdentityKey,
} from '../platform/resource-identity.js'
import {
  createResourcePlanningCooldownRequest,
  getMaximumSubjectsPerResourceJob,
  getResourceBatchMaximumItems,
  getResourcePlanningCooldowns,
  type ResourcePlanningCooldownRequest,
} from '../platform/resource-planning.js'
import type { JobPayloadByName } from './job-contracts.js'
import type { QueuePlanningContext } from './planning-context.js'
import type { QueueCommand } from './producer.js'

interface ResourcePlannerOptions {
  readonly highWaterMark?: number
  readonly pageSize?: number
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
}

export async function runResourcePlanner(
  context: QueuePlanningContext,
  options: ResourcePlannerOptions = {},
) {
  const { producer, signal } = context
  signal?.throwIfAborted()
  const resources = options.resources ?? platformResources
  if (resources.length === 0) return { selected: 0, planned: 0, reason: 'idle' as const }

  const highWaterMark = options.highWaterMark ?? env.QUEUE_HIGH_WATER_MARK
  const admission = await producer.inspectCapacity({
    source: 'planner',
    highWaterMark,
    preservePausedState: true,
  })
  if (admission.status === 'rejected')
    return { selected: 0, planned: 0, reason: 'capacity' as const, admission }

  const pageSize = options.pageSize ?? env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE
  const limit = Math.min(
    pageSize,
    admission.remainingCapacity * getMaximumSubjectsPerResourceJob(resources),
  )
  if (limit === 0) return { selected: 0, planned: 0, reason: 'capacity' as const, admission }

  signal?.throwIfAborted()
  const candidates = await selectDueInstalledResources({ limit, resources })
  signal?.throwIfAborted()
  if (candidates.length === 0)
    return { selected: 0, planned: 0, reason: 'idle' as const, admission }

  const workItems = createResourceWorkItems(candidates, resources, signal)
  const capacityPrefix = workItems.slice(0, admission.remainingCapacity)
  const cooldowns = await getResourcePlanningCooldowns(
    capacityPrefix.map(({ operation }) => operation),
  )
  signal?.throwIfAborted()
  if (cooldowns.length !== capacityPrefix.length)
    throw new Error('ESI cooldown batch did not correlate every planned resource')
  const firstCooldown = cooldowns.findIndex(({ active }) => active)
  const admittedPrefix = capacityPrefix.slice(
    0,
    firstCooldown === -1 ? capacityPrefix.length : firstCooldown,
  )
  signal?.throwIfAborted()
  const results = await producer.enqueueMany(
    admittedPrefix.map(({ descriptor, work }) => createResourceQueueCommand(descriptor, work)),
    { signal, preservePausedState: true },
  )
  const planned = results.filter(({ status }) => status === 'accepted').length
  const publicationPaused = results.some(
    (result) => result.status === 'rejected' && result.reason === 'planner-paused',
  )

  if (publicationPaused)
    return {
      selected: candidates.length,
      planned,
      reason: 'capacity' as const,
      admission,
    }
  if (firstCooldown !== -1)
    return {
      selected: candidates.length,
      planned,
      reason: 'cooldown' as const,
      admission,
    }
  if (workItems.length > capacityPrefix.length)
    return {
      selected: candidates.length,
      planned,
      reason: 'capacity' as const,
      admission,
    }

  return {
    selected: candidates.length,
    planned,
    reason: 'scheduled' as const,
    admission,
  }
}

function createResourceQueueCommand(
  descriptor: PlatformInstalledResourceDescriptor,
  work: ReturnType<typeof createBatchWork> | ReturnType<typeof createScalarWork>,
): QueueCommand {
  if (work.name === 'resource-refresh')
    return {
      name: 'resource-refresh',
      payload: work.payload,
      source: 'planner',
      materializationIntervalSeconds: descriptor.materializationIntervalSeconds,
    }
  return {
    name: 'resource-batch',
    payload: work.payload,
    source: 'planner',
    materializationIntervalSeconds: descriptor.materializationIntervalSeconds,
  }
}

function createResourceWorkItems(
  candidates: readonly DueInstalledResource[],
  resources: readonly PlatformInstalledResourceDescriptor[],
  signal?: AbortSignal,
) {
  const plannedBatchResources = new Set<string>()
  const workItems = [] as Array<{
    readonly descriptor: PlatformInstalledResourceDescriptor
    readonly operation: ResourcePlanningCooldownRequest
    readonly work: ReturnType<typeof createBatchWork> | ReturnType<typeof createScalarWork>
  }>
  for (const candidate of candidates) {
    signal?.throwIfAborted()
    const descriptor = findInstalledResource(candidate.identity, resources)
    if (!descriptor)
      throw new Error(
        `Due resource ${candidate.identity.moduleId}/${candidate.identity.resourceId} is not installed`,
      )
    const batchKey = installedResourceIdentityKey(descriptor)
    if (descriptor.batch && plannedBatchResources.has(batchKey)) continue

    const operation = createResourcePlanningCooldownRequest(candidate, descriptor)
    const work = descriptor.batch
      ? createBatchWork(descriptor, descriptor.batch, candidates, batchKey)
      : createScalarWork(candidate)
    if (descriptor.batch) plannedBatchResources.add(batchKey)
    workItems.push({ descriptor, operation, work })
  }
  return workItems
}

function createScalarWork(candidate: DueInstalledResource) {
  return {
    name: 'resource-refresh' as const,
    payload: candidate.identity,
  }
}

function createBatchWork(
  resource: PlatformInstalledResourceDescriptor,
  batch: NonNullable<PlatformInstalledResourceDescriptor['batch']>,
  candidates: readonly DueInstalledResource[],
  batchKey: string,
) {
  const maximumItems = getResourceBatchMaximumItems(batch.operationId)
  const subjects = candidates
    .filter(({ identity }) => installedResourceIdentityKey(identity) === batchKey)
    .slice(0, maximumItems)
    .map(({ identity }) => ({
      subjectLifecycleId: identity.subjectLifecycleId,
      subjectId: identity.subjectId,
    }))
  const payload: JobPayloadByName['resource-batch'] = {
    moduleId: resource.moduleId,
    resourceId: resource.resourceId,
    subjectKind: 'character',
    subjects,
  }
  return {
    name: 'resource-batch' as const,
    payload,
  }
}
