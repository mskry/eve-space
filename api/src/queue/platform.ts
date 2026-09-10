import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq'
import { closeCoordinationRedisConnection } from '../coordination-redis.js'
import { loadPlannerScheduleOffset } from '../deployment/installation-settings.js'
import { verifyDomainEventHandlers } from '../domain-events/handlers.js'
import { env } from '../env.js'
import { createBullMqQueueProducer } from './bullmq-producer.js'
import { sanitizeJobFailure } from './failures.js'
import { hasJobContract, parseJobPayload, verifyJobContracts } from './job-contracts.js'
import { executeJobHandler, verifyJobHandlers } from './job-handlers.js'
import { operationsQueueName, queuePrefix } from './namespaces.js'
import { createOperationsQueueHandle, type OperationsQueueHandle } from './operations-queue.js'
import { createQueueOutcomeRecorder } from './outcome-recorder.js'
import { createWorkerRedisConnection } from './redis.js'
import {
  createPlannerRepeatStrategy,
  getJobScheduler,
  plannerInitialDelay,
  registerSchedulers,
  runWithSchedulerOverlapPolicy,
} from './scheduler.js'
import { createActiveJobTracker, startWorkerHeartbeat } from './worker-lifecycle.js'

export async function enqueueDiagnostic(
  source: 'planner' | 'on-demand' = 'planner',
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const producer = createBullMqQueueProducer({ plannerDelay: plannerInitialDelay })
  try {
    signal?.throwIfAborted()
    return await producer.enqueue(
      {
        name: 'diagnostic',
        payload: { operationId: 'queue-diagnostic' },
        source,
      },
      { signal },
    )
  } finally {
    await producer.close()
  }
}

export async function startWorkerPlatform() {
  verifyJobContracts()
  verifyJobHandlers()
  verifyDomainEventHandlers()
  const plannerRepeatStrategy = createPlannerRepeatStrategy(
    await loadPlannerScheduleOffset(),
    env.QUEUE_PLANNER_INITIAL_DELAY_MAX_MS,
  )
  const connection = createWorkerRedisConnection()
  const activeJobs = createActiveJobTracker()
  const handle = createOperationsQueueHandle({ repeatStrategy: plannerRepeatStrategy })
  const producer = createBullMqQueueProducer({ handle, plannerDelay: plannerInitialDelay })
  const outcomes = createQueueOutcomeRecorder(handle.connection)
  const worker = new Worker(
    operationsQueueName,
    (job) => activeJobs.run(() => processJob(job, connection, producer, outcomes)),
    {
      connection,
      concurrency: env.QUEUE_OPERATION_CONCURRENCY,
      prefix: queuePrefix,
      settings: { repeatStrategy: plannerRepeatStrategy },
      // Autorun would claim jobs before the schedulers, heartbeat, and failure listener exist.
      autorun: false,
    },
  )
  let stopHeartbeat: () => void
  try {
    await registerSchedulers(handle.queue)
    stopHeartbeat = await startWorkerHeartbeat(connection)
  } catch (error) {
    await worker.close(true)
    await handle.close()
    await closeCoordinationRedisConnection(connection)
    throw error
  }
  worker.on('failed', (job, error) => {
    console.error('Worker job failed', {
      jobName: job?.name ?? 'unknown',
      ...domainEventJobLogContext(job),
      category: sanitizeJobFailure(error),
      reason: sanitizeJobFailure(error),
    })
  })
  let closing: Promise<boolean> | undefined
  // BullMQ does not restart the processing loop after `run()` settles.
  const stopped = worker.run().catch((error: unknown) => {
    if (!closing) console.error('Worker run loop stopped', sanitizeJobFailure(error))
  })

  return {
    stopped,
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
          await withDeadline(handle.close(), remaining())
          await withDeadline(closeCoordinationRedisConnection(connection), remaining())
        } catch {
          console.error('Worker shutdown exceeded its timeout; dropping queue connections')
          forceDisconnect(worker, handle, connection)
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
  handle: OperationsQueueHandle,
  connection: ReturnType<typeof createWorkerRedisConnection>,
) {
  // `disconnect()` stops the retry strategy outright, unlike `quit()`, which waits for a reply an
  // unreachable Redis will never send.
  connection.disconnect()
  handle.disconnect()
  // BullMQ's duplicated blocking client is not ours to close, and alone keeps the process alive.
  void Promise.allSettled([worker.close(true), worker.disconnect()])
}

async function processJob(
  job: Job,
  connection: ReturnType<typeof createWorkerRedisConnection>,
  producer: ReturnType<typeof createBullMqQueueProducer>,
  outcomes: ReturnType<typeof createQueueOutcomeRecorder>,
) {
  if (!hasJobContract(job.name)) throw new UnrecoverableError(`Unknown job type ${job.name}`)
  const name = job.name
  let payload
  try {
    payload = parseJobPayload(name, job.data)
  } catch {
    throw new UnrecoverableError(`Invalid ${job.name} job payload`)
  }
  const scheduler = getJobScheduler(name)
  const execute = (signal: AbortSignal) =>
    executeJobHandler(name, payload, { producer, outcomes, signal })
  const disposition = scheduler
    ? await runWithSchedulerOverlapPolicy(
        connection,
        scheduler.schedulerId,
        scheduler.overlap,
        execute,
      ).then((result) => (result.executed ? result.result : { type: 'completed' as const }))
    : await execute(new AbortController().signal)
  if (disposition.type === 'delayed') {
    await job.moveToDelayed(disposition.retryAt, job.token)
    throw new DelayedError('Dependency cooldown deferred this job')
  }
  if (disposition.type === 'permanent') throw new UnrecoverableError('Permanent job failure')
  if (disposition.type === 'retryable') throw new Error(sanitizeJobFailure(disposition.error))
  if (job.name === 'domain-event')
    console.info('Domain event job processed', domainEventJobLogContext(job))
}

function domainEventJobLogContext(job: Job | undefined) {
  if (job?.name !== 'domain-event' || typeof job.data !== 'object' || job.data === null) return {}
  const eventId = 'eventId' in job.data ? job.data.eventId : null
  return typeof eventId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)
    ? { eventId }
    : {}
}
