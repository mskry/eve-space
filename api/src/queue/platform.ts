import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq'
import { closeCoordinationRedisConnection } from '../coordination-redis.js'
import { loadPlannerScheduleOffset } from '../deployment/installation-settings.js'
import { verifyDomainEventHandlers } from '../domain-events/handlers.js'
import { env } from '../env.js'
import { waitForAbort } from '../shutdown-deadline.js'
import type { WorkerPlatform, WorkerPlatformCloseResult } from '../worker-platform.js'
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

export async function startWorkerPlatform(signal?: AbortSignal): Promise<WorkerPlatform> {
  signal?.throwIfAborted()
  verifyJobContracts()
  verifyJobHandlers()
  verifyDomainEventHandlers()
  const plannerRepeatStrategy = createPlannerRepeatStrategy(
    await waitForAbort(loadPlannerScheduleOffset(), signal),
    env.QUEUE_PLANNER_INITIAL_DELAY_MAX_MS,
  )
  signal?.throwIfAborted()
  const connection = createWorkerRedisConnection()
  const activeJobs = createActiveJobTracker()
  const activeWork = new AbortController()
  const handle = createOperationsQueueHandle({ repeatStrategy: plannerRepeatStrategy })
  const producer = createBullMqQueueProducer({ handle, plannerDelay: plannerInitialDelay })
  const outcomes = createQueueOutcomeRecorder(handle.connection)
  const worker = new Worker(
    operationsQueueName,
    (job) =>
      activeJobs.run(() => processJob(job, connection, producer, outcomes, activeWork.signal)),
    {
      connection,
      concurrency: env.QUEUE_OPERATION_CONCURRENCY,
      prefix: queuePrefix,
      settings: { repeatStrategy: plannerRepeatStrategy },
      // Autorun would claim jobs before the schedulers, heartbeat, and failure listener exist.
      autorun: false,
    },
  )
  let blockingConnection: { disconnect(): void } | undefined
  let stopHeartbeat: (() => void) | undefined
  let forcedCleanup: Promise<void> | undefined
  const forceClose = (cleanupBudgetMs: number): Promise<void> => {
    if (forcedCleanup) return forcedCleanup
    stopHeartbeat?.()
    activeWork.abort()
    disconnect(connection)
    disconnect(blockingConnection)
    disconnect(handle.connection)
    forcedCleanup = settleForcedBullMqCleanup(worker, handle, cleanupBudgetMs)
    return forcedCleanup
  }
  try {
    const blockingClient = worker.getBackend().blockingClient
    if (!blockingClient) throw new Error('BullMQ worker blocking connection is unavailable')
    blockingConnection = await waitForAbort(blockingClient, signal)
    await waitForAbort(registerSchedulers(handle.queue), signal)
    stopHeartbeat = await waitForAbort(startWorkerHeartbeat(connection), signal)
    signal?.throwIfAborted()
  } catch (error) {
    await forceClose(forcedCleanupReserve(env.WORKER_SHUTDOWN_TIMEOUT_MS))
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
  let closing: Promise<WorkerPlatformCloseResult> | undefined
  // BullMQ does not restart the processing loop after `run()` settles.
  const stopped = worker.run().catch((error: unknown) => {
    if (!closing) console.error('Worker run loop stopped', sanitizeJobFailure(error))
  })

  return {
    stopped,
    close(timeoutMs = env.WORKER_SHUTDOWN_TIMEOUT_MS) {
      closing ??= (async () => {
        stopHeartbeat?.()
        const shutdown = createPlatformShutdownBudget(timeoutMs)
        let drained = false
        try {
          await withDeadline(worker.pause(true), shutdown.gracefulRemaining())
          drained = await activeJobs.waitForIdle(shutdown.gracefulRemaining())
          if (!drained) {
            activeWork.abort()
            await activeJobs.waitForIdle(shutdown.cancellationRemaining())
            await forceClose(shutdown.forcedCleanupRemaining())
            return { drained: false, timedOut: true }
          }
          await withDeadline(worker.close(), shutdown.cancellationRemaining())
          await withDeadline(handle.close(), shutdown.cancellationRemaining())
          await withDeadline(
            closeCoordinationRedisConnection(connection, shutdown.cancellationRemaining()),
            shutdown.cancellationRemaining(),
          )
        } catch (error) {
          activeWork.abort()
          await activeJobs.waitForIdle(shutdown.cancellationRemaining())
          await forceClose(shutdown.forcedCleanupRemaining())
          if (error === shutdownTimeout) return { drained: false, timedOut: true }
          throw error
        }
        return { drained, timedOut: false }
      })()
      return closing
    },
    forceClose() {
      void forceClose(0)
    },
  }
}

const shutdownTimeout = new Error('Worker shutdown timed out')

function createPlatformShutdownBudget(timeoutMs: number) {
  const boundedTimeoutMs = Math.max(0, timeoutMs)
  const forcedCleanupReserveMs = forcedCleanupReserve(boundedTimeoutMs)
  const cancellationReserveMs = Math.min(
    1_000,
    Math.floor((boundedTimeoutMs - forcedCleanupReserveMs) / 3),
  )
  const expiresAt = Date.now() + boundedTimeoutMs
  const forcedCleanupStartsAt = expiresAt - forcedCleanupReserveMs
  const cancellationStartsAt = forcedCleanupStartsAt - cancellationReserveMs
  return {
    gracefulRemaining: () => Math.max(0, cancellationStartsAt - Date.now()),
    cancellationRemaining: () => Math.max(0, forcedCleanupStartsAt - Date.now()),
    forcedCleanupRemaining: () => Math.max(0, expiresAt - Date.now()),
  }
}

function forcedCleanupReserve(timeoutMs: number): number {
  return Math.min(1_000, Math.floor(Math.max(0, timeoutMs) / 4))
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(shutdownTimeout), timeoutMs)
  })
  operation.catch(() => {})
  try {
    return await Promise.race([operation, expiry])
  } finally {
    clearTimeout(timer)
  }
}

async function settleForcedBullMqCleanup(
  worker: Worker,
  handle: OperationsQueueHandle,
  timeoutMs: number,
) {
  const cleanup = Promise.allSettled([
    Promise.resolve().then(() => worker.close(true)),
    Promise.resolve().then(() => handle.queue.close()),
  ])
  try {
    await withDeadline(cleanup, timeoutMs)
  } catch (error) {
    if (error !== shutdownTimeout) throw error
  }
}

function disconnect(connection: { disconnect(): void } | undefined): void {
  try {
    connection?.disconnect()
  } catch {
    // Forced cleanup must continue through every owned socket.
  }
}

async function processJob(
  job: Job,
  connection: ReturnType<typeof createWorkerRedisConnection>,
  producer: ReturnType<typeof createBullMqQueueProducer>,
  outcomes: ReturnType<typeof createQueueOutcomeRecorder>,
  workerSignal: AbortSignal,
) {
  workerSignal.throwIfAborted()
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
    executeJobHandler(name, payload, {
      producer,
      outcomes,
      signal: signal === workerSignal ? signal : AbortSignal.any([workerSignal, signal]),
    })
  const disposition = scheduler
    ? await runWithSchedulerOverlapPolicy(
        connection,
        scheduler.schedulerId,
        scheduler.overlap,
        execute,
      ).then((result) => (result.executed ? result.result : { type: 'completed' as const }))
    : await execute(workerSignal)
  workerSignal.throwIfAborted()
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
