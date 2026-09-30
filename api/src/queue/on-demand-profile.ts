import type { PlatformInstalledOnDemandProfileResourceDescriptor } from '@eve-space/platform-module-contract/installed'
import type {
  PlatformOnDemandProfileOutcome,
  PlatformOnDemandProfileRequest,
  PlatformOnDemandProfileRequester,
} from '@eve-space/platform-module-contract/server'
import { getSharedCoordinationRedisConnection } from '../coordination-redis.js'
import { planInstalledProfileWork } from '../platform/profile-work.js'
import {
  selectDueInstalledResources,
  type DueInstalledResource,
} from '../platform/resource-eligibility.js'
import {
  createResourcePlanningCooldownRequest,
  getResourcePlanningCooldowns,
} from '../platform/resource-planning.js'
import { platformResources } from '../platform/resources.js'
import { createBullMqQueueProducer } from './bullmq-producer.js'
import { profileRefreshJobId } from './job-contracts.js'
import { createOperationsQueueHandle, type OperationsQueueHandle } from './operations-queue.js'
import { createProfileCommand } from './profile-work-planner.js'

const completionWaitMs = 3_000
const completionPollMs = 250
const maximumConcurrentWaits = 16
const maximumResponseWaitMs = 5_000

const boundedProfileRequest = async (
  pending: Promise<PlatformOnDemandProfileOutcome>,
): Promise<PlatformOnDemandProfileOutcome> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<PlatformOnDemandProfileOutcome>((resolve) => {
        timer = setTimeout(resolve, maximumResponseWaitMs, 'waiting')
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const waitForProfileJob = async (
  handle: OperationsQueueHandle,
  identity: string,
  deadline: number,
): Promise<PlatformOnDemandProfileOutcome> => {
  const jobId = await handle.queue.getDeduplicationJobId(identity)
  if (!jobId) return 'completed'
  const poll = async (): Promise<PlatformOnDemandProfileOutcome> => {
    const state = await handle.queue.getJobState(jobId)
    if (state === 'completed' || state === 'unknown') return 'completed'
    if (state === 'failed') return 'unavailable'
    const outcome = state === 'active' ? 'collecting' : 'queued'
    if (Date.now() >= deadline || state === 'delayed') return outcome
    await new Promise((resolve) => setTimeout(resolve, completionPollMs))
    return poll()
  }
  return poll()
}

export const createOnDemandProfileRequester = (
  descriptor: PlatformInstalledOnDemandProfileResourceDescriptor,
): PlatformOnDemandProfileRequester => {
  const resource = platformResources.find(
    ({ moduleId, resourceId }) =>
      moduleId === descriptor.moduleId && resourceId === descriptor.resourceId,
  )
  if (!resource?.profileKeyed || resource.subjectKind !== 'deployment') {
    throw new Error('On-demand profile resource is missing')
  }
  let sharedHandle: OperationsQueueHandle | undefined
  const inFlight = new Map<string, Promise<PlatformOnDemandProfileOutcome>>()
  let waits = 0

  // The handle borrows the process-wide coordination connection, whose shutdown owns its lifetime.
  const queueHandle = () =>
    (sharedHandle ??= createOperationsQueueHandle({
      connection: getSharedCoordinationRedisConnection(),
    }))

  const loadCandidate = async () => {
    const [candidate] = await selectDueInstalledResources({
      includeProfileKeyed: true,
      limit: 1,
      resources: [resource],
    })
    return candidate
  }

  const loadWork = async (candidate: DueInstalledResource, profileId: string) => {
    const work = await planInstalledProfileWork(candidate.identity, new Date().toISOString(), 16, {
      resources: [resource],
    })
    return work.find((item) => item.profileId === profileId)
  }

  const coolingDown = async (candidate: DueInstalledResource) => {
    const [status] = await getResourcePlanningCooldowns([
      createResourcePlanningCooldownRequest(candidate, resource),
    ])
    return status?.active !== false
  }

  const admitAndWait = async (
    input: PlatformOnDemandProfileRequest,
  ): Promise<PlatformOnDemandProfileOutcome> => {
    const candidate = await loadCandidate()
    if (!candidate) return 'unavailable'
    // The route has already saved durable demand, so backoff or planner capacity only delays it.
    const work = await loadWork(candidate, input.profileId)
    if (!work) return 'waiting'
    if (work.revision !== input.revision) return 'unavailable'
    if (await coolingDown(candidate)) return 'waiting'
    const handle = queueHandle()
    const command = createProfileCommand(
      { ...work, requestedTypeId: input.typeId },
      resource,
      'on-demand',
    )
    const result = await createBullMqQueueProducer({ handle }).enqueue(command)
    if (result.status === 'rejected' && result.reason !== 'coalesced') return 'waiting'
    if (waits >= maximumConcurrentWaits) return 'queued'
    const deadline = Date.now() + completionWaitMs
    waits += 1
    try {
      return await waitForProfileJob(handle, profileRefreshJobId(command.payload), deadline)
    } finally {
      waits -= 1
    }
  }

  return {
    async request(input, signal) {
      if (!Number.isSafeInteger(input.typeId) || input.typeId <= 0) return 'unavailable'
      if (signal?.aborted) return 'unavailable'
      const key = JSON.stringify([input.profileId, input.revision, input.typeId])
      let pending = inFlight.get(key)
      if (!pending) {
        pending = boundedProfileRequest(admitAndWait(input))
          .catch((): PlatformOnDemandProfileOutcome => 'unavailable')
          .finally(() => inFlight.delete(key))
        inFlight.set(key, pending)
      }
      return pending
    },
  }
}
