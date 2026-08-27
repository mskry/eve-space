import type { Queue } from 'bullmq'
import { env } from '../env.js'
import { outboxRelayStateKey, plannerStateKey } from './namespaces.js'

export class QueueAdmissionError extends Error {
  constructor() {
    super('Queue admission is temporarily unavailable')
  }
}

export interface QueueAdmission {
  admitted: boolean
  depth: number
  reason?: 'planner-paused' | 'outbox-paused' | 'on-demand-rejected' | 'coalesced'
}

export interface QueueAdmissionCapacity extends QueueAdmission {
  remainingCapacity: number
}

interface QueueAdmissionCapacityOptions {
  readonly preservePausedState?: boolean
}

export async function getQueueAdmissionCapacity(
  queue: Queue,
  source: 'planner' | 'on-demand' | 'outbox',
  highWaterMark = env.QUEUE_HIGH_WATER_MARK,
  options: QueueAdmissionCapacityOptions = {},
): Promise<QueueAdmissionCapacity> {
  const counts = await queue.getJobCounts('waiting', 'delayed', 'prioritized')
  const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0)
  const remainingCapacity = Math.max(0, highWaterMark - depth)
  if (remainingCapacity === 0) {
    if (source === 'planner') {
      await queue
        .getBackend()
        .client.then((connection) => connection.set(plannerStateKey, 'paused'))
      return { admitted: false, depth, remainingCapacity, reason: 'planner-paused' }
    }
    if (source === 'outbox') {
      await queue
        .getBackend()
        .client.then((connection) => connection.set(outboxRelayStateKey, 'paused'))
      return { admitted: false, depth, remainingCapacity, reason: 'outbox-paused' }
    }
    throw new QueueAdmissionError()
  }

  if (source === 'planner' && !options.preservePausedState)
    await queue.getBackend().client.then((connection) => connection.del(plannerStateKey))
  if (source === 'outbox' && !options.preservePausedState)
    await queue.getBackend().client.then((connection) => connection.del(outboxRelayStateKey))

  return { admitted: true, depth, remainingCapacity }
}

export async function admitQueueWork(
  queue: Queue,
  operationIdentity: string,
  source: 'planner' | 'on-demand' | 'outbox',
  highWaterMark = env.QUEUE_HIGH_WATER_MARK,
): Promise<QueueAdmission> {
  const capacity = await getQueueAdmissionCapacity(queue, source, highWaterMark)
  const { admitted, depth, reason } = capacity
  if (!admitted) return { admitted, depth, reason }

  if (source === 'planner' && (await hasActiveOperation(queue, operationIdentity)))
    return { admitted: false, depth, reason: 'coalesced' }

  return { admitted: true, depth }
}

async function hasActiveOperation(queue: Queue, operationIdentity: string) {
  const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized'])
  return jobs.some(
    (job) =>
      typeof job.data === 'object' &&
      job.data !== null &&
      'operationId' in job.data &&
      job.data.operationId === operationIdentity,
  )
}
