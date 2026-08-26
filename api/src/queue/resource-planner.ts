import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import type { Queue } from 'bullmq'
import { assertRegisteredEsiOperation, getEsiOperationContract } from '../esi-resilience/catalog.js'
import { getEsiRequestCooldowns } from '../esi-resilience/cooldowns.js'
import { characterEsiPrincipal } from '../esi-resilience/identity.js'
import { env } from '../env.js'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'
import { findInstalledResource } from '../platform/resource-declarations.js'
import {
  selectDueInstalledResources,
  type DueInstalledResource,
} from '../platform/resource-eligibility.js'
import { getQueueAdmissionCapacity } from './admission.js'
import {
  getJobDefinition,
  jobOptions,
  resourceBatchJobId,
  resourceRefreshJobId,
  type JobDefinition,
  type PlatformResourceBatchJobPayload,
} from './job-registry.js'
import { resourceRefreshPriority } from './policy.js'
import { plannerInitialDelay } from './scheduler.js'
import type { QueueRedisConnection } from './redis.js'

interface ResourcePlannerOptions {
  readonly highWaterMark?: number
  readonly pageSize?: number
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly dependencies?: Partial<ResourcePlannerDependencies>
}

interface ResourcePlannerDependencies {
  readonly selectDue: typeof selectDueInstalledResources
  readonly getCooldowns: typeof getEsiRequestCooldowns
  readonly getCapacity: typeof getQueueAdmissionCapacity
  readonly getInitialDelay: typeof plannerInitialDelay
}

const defaultDependencies: ResourcePlannerDependencies = {
  selectDue: selectDueInstalledResources,
  getCooldowns: getEsiRequestCooldowns,
  getCapacity: getQueueAdmissionCapacity,
  getInitialDelay: plannerInitialDelay,
}

export async function runResourcePlanner(
  queue: Queue,
  signal?: AbortSignal,
  options: ResourcePlannerOptions = {},
) {
  const dependencies = { ...defaultDependencies, ...options.dependencies }
  signal?.throwIfAborted()
  const resources = options.resources ?? installedModuleResources
  if (resources.length === 0) return { selected: 0, planned: 0, reason: 'idle' as const }

  const highWaterMark = options.highWaterMark ?? env.QUEUE_HIGH_WATER_MARK
  const admission = await dependencies.getCapacity(queue, 'planner', highWaterMark, {
    preservePausedState: true,
  })
  if (!admission.admitted)
    return { selected: 0, planned: 0, reason: 'capacity' as const, admission }

  const pageSize = options.pageSize ?? env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE
  const limit = Math.min(
    pageSize,
    admission.remainingCapacity * getMaximumSubjectsPerJob(resources),
  )
  if (limit === 0) return { selected: 0, planned: 0, reason: 'capacity' as const, admission }

  signal?.throwIfAborted()
  const candidates = await dependencies.selectDue({ limit, resources })
  signal?.throwIfAborted()
  if (candidates.length === 0)
    return { selected: 0, planned: 0, reason: 'idle' as const, admission }

  const connection = (await queue.getBackend().client) as unknown as QueueRedisConnection
  const plannedBatchResources = new Set<string>()
  const workItems = [] as Array<{
    readonly descriptor: PlatformInstalledResourceDescriptor
    readonly operation: Parameters<typeof getEsiRequestCooldowns>[0]['requests'][number]
    readonly work: ReturnType<typeof createBatchWork> | ReturnType<typeof createScalarWork>
  }>
  for (const candidate of candidates) {
    signal?.throwIfAborted()
    const descriptor = findInstalledResource(candidate.identity, resources)
    if (!descriptor)
      throw new Error(
        `Due resource ${candidate.identity.moduleId}/${candidate.identity.resourceId} is not installed`,
      )
    const batchKey = `${descriptor.moduleId}\0${descriptor.resourceId}\0${descriptor.subjectKind}`
    if (descriptor.batch && plannedBatchResources.has(batchKey)) continue

    const operationId = descriptor.batch?.operationId ?? candidate.operationId
    assertRegisteredEsiOperation(operationId)
    const authorization = getEsiOperationContract(operationId).authorization
    const operation = {
      operation: operationId,
      ...(authorization.kind === 'character'
        ? { principal: characterEsiPrincipal(candidate.identity.subjectId) }
        : {}),
    }
    const work = descriptor.batch
      ? createBatchWork(descriptor, descriptor.batch, candidates, batchKey)
      : createScalarWork(candidate)
    if (descriptor.batch) plannedBatchResources.add(batchKey)
    workItems.push({ descriptor, operation, work })
  }

  const capacityPrefix = workItems.slice(0, admission.remainingCapacity)
  const cooldowns = await dependencies.getCooldowns({
    connection,
    requests: capacityPrefix.map(({ operation }) => operation),
  })
  signal?.throwIfAborted()
  if (cooldowns.length !== capacityPrefix.length)
    throw new Error('ESI cooldown batch did not correlate every planned resource')
  const firstCooldown = cooldowns.findIndex(({ active }) => active)
  const admittedPrefix = capacityPrefix.slice(
    0,
    firstCooldown === -1 ? capacityPrefix.length : firstCooldown,
  )
  const delays = await Promise.all(admittedPrefix.map(() => dependencies.getInitialDelay()))
  signal?.throwIfAborted()
  if (admittedPrefix.length > 0)
    await queue.addBulk(
      admittedPrefix.map(({ descriptor, work }, index) => {
        const definition = getJobDefinition(work.name) as JobDefinition<unknown>
        const delay = delays[index] ?? 0
        return {
          name: definition.name,
          data: work.payload,
          opts: {
            ...jobOptions(definition),
            ...(delay > 0 ? { delay } : {}),
            deduplication: { id: work.deduplicationId },
            priority: resourceRefreshPriority(descriptor.materializationIntervalSeconds),
          },
        }
      }),
    )
  const planned = admittedPrefix.length

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

function createScalarWork(candidate: DueInstalledResource) {
  return {
    name: 'resource-refresh' as const,
    payload: candidate.identity,
    deduplicationId: resourceRefreshJobId(candidate.identity),
  }
}

function getMaximumSubjectsPerJob(resources: readonly PlatformInstalledResourceDescriptor[]) {
  return resources.reduce((maximum, resource) => {
    if (!resource.batch) return maximum
    assertRegisteredEsiOperation(resource.batch.operationId)
    const contract = getEsiOperationContract(resource.batch.operationId)
    if (contract.authorization.kind !== 'public' || contract.identity.kind !== 'set')
      throw new Error(
        `Installed resource ${resource.moduleId}/${resource.resourceId} has invalid batch operation policy`,
      )
    return Math.max(maximum, contract.identity.maximumItems)
  }, 1)
}

function createBatchWork(
  resource: PlatformInstalledResourceDescriptor,
  batch: NonNullable<PlatformInstalledResourceDescriptor['batch']>,
  candidates: readonly DueInstalledResource[],
  batchKey: string,
) {
  assertRegisteredEsiOperation(batch.operationId)
  const contract = getEsiOperationContract(batch.operationId)
  if (contract.identity.kind !== 'set')
    throw new Error('Resource batch operation must use set identity')
  const subjects = candidates
    .filter(
      ({ identity }) =>
        `${identity.moduleId}\0${identity.resourceId}\0${identity.subjectKind}` === batchKey,
    )
    .slice(0, contract.identity.maximumItems)
    .map(({ identity }) => ({
      subjectLifecycleId: identity.subjectLifecycleId,
      subjectId: identity.subjectId,
    }))
  const payload: PlatformResourceBatchJobPayload = {
    moduleId: resource.moduleId,
    resourceId: resource.resourceId,
    subjectKind: resource.subjectKind,
    subjects,
  }
  return {
    name: 'resource-batch' as const,
    payload,
    deduplicationId: resourceBatchJobId(payload),
  }
}
