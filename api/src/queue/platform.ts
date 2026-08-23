import { Queue, UnrecoverableError, Worker, type Job, type RepeatStrategy } from 'bullmq'
import { loadPlannerScheduleOffset } from '../deployment-installation-settings.js'
import { env } from '../env.js'
import { admitQueueWork } from './admission.js'
import { sanitizeJobFailure } from './failures.js'
import {
  getJobDefinition,
  type JobDefinition,
  validateJobPayload,
  verifyJobRegistry,
} from './job-registry.js'
import { operationsQueueName, queuePrefix } from './namespaces.js'
import {
  closeQueueRedisConnection,
  createProducerRedisConnection,
  createWorkerRedisConnection,
} from './redis.js'
import {
  diagnosticOverlapPolicy,
  diagnosticSchedulerId,
  createPlannerRepeatStrategy,
  plannerInitialDelay,
  registerSchedulers,
  runWithSchedulerOverlapPolicy,
} from './scheduler.js'
import { createActiveJobTracker, startWorkerHeartbeat } from './worker-lifecycle.js'

const queueConnections = new WeakMap<Queue, ReturnType<typeof createProducerRedisConnection>>()

export function createOperationsQueue(repeatStrategy?: RepeatStrategy) {
  const connection = createProducerRedisConnection()
  const queue = new Queue(operationsQueueName, {
    connection,
    prefix: queuePrefix,
    ...(repeatStrategy ? { settings: { repeatStrategy } } : {}),
    skipWaitingForReady: true,
  })
  queueConnections.set(queue, connection)
  return queue
}

export async function closeOperationsQueue(queue: Queue) {
  await closeQueue(queue)
}

export async function enqueueDiagnostic(
  source: 'planner' | 'on-demand' = 'planner',
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const queue = createOperationsQueue()
  try {
    const definition = getJobDefinition('diagnostic') as JobDefinition<{
      operationId: 'queue-diagnostic'
    }>
    const payload = { operationId: 'queue-diagnostic' as const }
    const admission = await admitQueueWork(queue, definition.operationIdentity(payload), source)
    if (!admission.admitted) return admission
    const delay = source === 'planner' ? await plannerInitialDelay() : 0

    // Admission and the delay lookup are round trips; the lease can go while they are in flight.
    signal?.throwIfAborted()
    await queue.add(definition.name, payload, {
      attempts: definition.attempts,
      backoff: { type: 'exponential', delay: 1_000, jitter: 0.25 },
      ...(delay > 0 ? { delay } : {}),
      removeOnComplete: {
        age: env.QUEUE_COMPLETED_RETENTION_AGE_SECONDS,
        count: env.QUEUE_COMPLETED_RETENTION_COUNT,
      },
      removeOnFail: {
        age: env.QUEUE_FAILED_RETENTION_AGE_SECONDS,
        count: env.QUEUE_FAILED_RETENTION_COUNT,
      },
    })
    return admission
  } finally {
    await closeQueue(queue)
  }
}

export async function startWorkerPlatform() {
  verifyJobRegistry()
  const plannerRepeatStrategy = createPlannerRepeatStrategy(
    await loadPlannerScheduleOffset(),
    env.QUEUE_PLANNER_INITIAL_DELAY_MAX_MS,
  )
  const connection = createWorkerRedisConnection()
  const activeJobs = createActiveJobTracker()
  const worker = new Worker(
    operationsQueueName,
    (job) => activeJobs.run(() => processJob(job, connection)),
    {
      connection,
      concurrency: env.QUEUE_OPERATION_CONCURRENCY,
      prefix: queuePrefix,
      settings: { repeatStrategy: plannerRepeatStrategy },
      // Autorun would claim jobs before the schedulers, heartbeat, and failure listener exist.
      autorun: false,
    },
  )
  const queue = createOperationsQueue(plannerRepeatStrategy)
  let stopHeartbeat: () => void
  try {
    await registerSchedulers(queue)
    stopHeartbeat = await startWorkerHeartbeat(connection)
  } catch (error) {
    await worker.close(true)
    await closeQueue(queue)
    await closeQueueRedisConnection(connection)
    throw error
  }
  worker.on('failed', (job, error) => {
    console.error('Worker job failed', {
      jobName: job?.name ?? 'unknown',
      reason: sanitizeJobFailure(error),
    })
  })
  void worker.run().catch((error: unknown) => {
    console.error('Worker run loop stopped', sanitizeJobFailure(error))
  })
  let closing: Promise<boolean> | undefined

  return {
    close(timeoutMs = env.WORKER_SHUTDOWN_TIMEOUT_MS) {
      closing ??= (async () => {
        stopHeartbeat()
        // One budget for the whole teardown: the worker connection retries forever, so an
        // unreachable Redis would otherwise hold pause/close/quit open until Compose kills us.
        const deadline = Date.now() + timeoutMs
        const remaining = () => Math.max(0, deadline - Date.now())
        let drained = false
        try {
          await withDeadline(worker.pause(true), remaining())
          drained = await activeJobs.waitForIdle(remaining())
          await withDeadline(worker.close(!drained), remaining())
          await withDeadline(closeQueue(queue), remaining())
          await withDeadline(closeQueueRedisConnection(connection), remaining())
        } catch {
          console.error('Worker shutdown exceeded its timeout; dropping queue connections')
          forceDisconnect(worker, queue, connection)
        }
        return drained
      })()
      return closing
    },
  }
}

/** Bounds one shutdown step. The loser keeps a no-op handler because it may still reject later. */
async function withDeadline<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Shutdown step timed out')), timeoutMs)
  })
  operation.catch(() => {})
  try {
    return await Promise.race([operation, expiry])
  } finally {
    clearTimeout(timer)
  }
}

function forceDisconnect(
  worker: Worker,
  queue: Queue,
  connection: ReturnType<typeof createWorkerRedisConnection>,
) {
  // `disconnect()` stops the retry strategy outright, unlike `quit()`, which waits for a reply an
  // unreachable Redis will never send.
  connection.disconnect()
  queueConnections.get(queue)?.disconnect()
  // BullMQ's duplicated blocking client is not ours to close, and alone keeps the process alive.
  void Promise.allSettled([worker.disconnect(), queue.disconnect()])
}

async function processJob(job: Job, connection: ReturnType<typeof createWorkerRedisConnection>) {
  const definition = getJobDefinition(job.name)
  if (!definition) throw new UnrecoverableError(`Unknown job type ${job.name}`)
  const payload = validateJobPayload(definition, job.data)
  try {
    if (job.name === 'planner') {
      await runWithSchedulerOverlapPolicy(
        connection,
        diagnosticSchedulerId,
        diagnosticOverlapPolicy,
        (signal) => definition.process(payload as never, signal),
      )
    } else {
      await definition.process(payload as never)
    }
  } catch (error) {
    if (definition.classifyError(error) === 'permanent')
      throw new UnrecoverableError('Permanent job failure')
    throw error
  }
}

async function closeQueue(queue: Queue) {
  await queue.close()
  const connection = queueConnections.get(queue)
  if (connection) await closeQueueRedisConnection(connection)
}
