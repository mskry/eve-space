import {
  DelayedError,
  Queue,
  UnrecoverableError,
  Worker,
  type Job,
  type RepeatStrategy,
} from 'bullmq'
import { AffiliationCooldownError } from '../affiliation-sync.js'
import { loadPlannerScheduleOffset } from '../deployment-installation-settings.js'
import { verifyDomainEventHandlers } from '../domain-event-handlers.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { env } from '../env.js'
import { admitQueueWork } from './admission.js'
import { sanitizeJobFailure } from './failures.js'
import {
  getJobDefinition,
  jobOptions,
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
  createPlannerRepeatStrategy,
  getJobScheduler,
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
      ...jobOptions(definition),
      ...(delay > 0 ? { delay } : {}),
    })
    return admission
  } finally {
    await closeQueue(queue)
  }
}

export async function startWorkerPlatform() {
  verifyJobRegistry()
  verifyDomainEventHandlers()
  const plannerRepeatStrategy = createPlannerRepeatStrategy(
    await loadPlannerScheduleOffset(),
    env.QUEUE_PLANNER_INITIAL_DELAY_MAX_MS,
  )
  const connection = createWorkerRedisConnection()
  const activeJobs = createActiveJobTracker()
  const queue = createOperationsQueue(plannerRepeatStrategy)
  const worker = new Worker(
    operationsQueueName,
    (job) => activeJobs.run(() => processJob(job, connection, queue)),
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
  void Promise.allSettled([worker.close(true), worker.disconnect(), queue.disconnect()])
}

async function processJob(
  job: Job,
  connection: ReturnType<typeof createWorkerRedisConnection>,
  queue: Queue,
) {
  const definition = getJobDefinition(job.name)
  if (!definition) throw new UnrecoverableError(`Unknown job type ${job.name}`)
  const payload = validateJobPayload(definition, job.data)
  try {
    const scheduler = getJobScheduler(job.name)
    if (scheduler) {
      await runWithSchedulerOverlapPolicy(
        connection,
        scheduler.schedulerId,
        scheduler.overlap,
        (signal) => definition.process(payload as never, signal, { queue }),
      )
    } else {
      await definition.process(payload as never, undefined, { queue })
    }
    if (definition.name === 'domain-event')
      console.info('Domain event job processed', domainEventJobLogContext(job))
  } catch (error) {
    if (error instanceof AffiliationCooldownError || error instanceof EsiQuotaError) {
      await job.moveToDelayed(Date.now() + error.retryAfterSeconds * 1_000, job.token)
      throw new DelayedError('ESI cooldown deferred this job')
    }
    if (definition.classifyError(error) === 'permanent')
      throw new UnrecoverableError('Permanent job failure')
    throw error
  }
}

function domainEventJobLogContext(job: Job | undefined) {
  if (job?.name !== 'domain-event' || typeof job.data !== 'object' || job.data === null) return {}
  const eventId = 'eventId' in job.data ? job.data.eventId : null
  return typeof eventId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)
    ? { eventId }
    : {}
}

async function closeQueue(queue: Queue) {
  await queue.close()
  const connection = queueConnections.get(queue)
  if (connection) await closeQueueRedisConnection(connection)
}
