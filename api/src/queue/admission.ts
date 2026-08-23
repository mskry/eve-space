import type { Queue } from 'bullmq'
import { env } from '../env.js'
import { plannerStateKey } from './namespaces.js'

export class QueueAdmissionError extends Error {
  constructor() {
    super('Queue admission is temporarily unavailable')
  }
}

export interface QueueAdmission {
  admitted: boolean
  depth: number
  reason?: 'planner-paused' | 'on-demand-rejected' | 'coalesced'
}

export async function admitQueueWork(
  queue: Queue,
  operationIdentity: string,
  source: 'planner' | 'on-demand',
  highWaterMark = env.QUEUE_HIGH_WATER_MARK,
): Promise<QueueAdmission> {
  const counts = await queue.getJobCounts('waiting', 'delayed')
  const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0)
  if (depth >= highWaterMark) {
    if (source === 'planner') {
      await queue
        .getBackend()
        .client.then((connection) => connection.set(plannerStateKey, 'paused'))
      return { admitted: false, depth, reason: 'planner-paused' }
    }
    throw new QueueAdmissionError()
  }

  if (source === 'planner') {
    await queue.getBackend().client.then((connection) => connection.del(plannerStateKey))
    if (await hasActiveOperation(queue, operationIdentity))
      return { admitted: false, depth, reason: 'coalesced' }
  }

  return { admitted: true, depth }
}

async function hasActiveOperation(queue: Queue, operationIdentity: string) {
  const jobs = await queue.getJobs(['active', 'waiting', 'delayed'])
  return jobs.some(
    (job) =>
      typeof job.data === 'object' &&
      job.data !== null &&
      'operationId' in job.data &&
      job.data.operationId === operationIdentity,
  )
}
