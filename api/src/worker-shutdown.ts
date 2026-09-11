import {
  createShutdownDeadline,
  waitForShutdownOperation,
  type ShutdownDeadline,
  type ShutdownOperationResult,
} from './shutdown-deadline.js'
import type { WorkerPlatform, WorkerPlatformCloseResult } from './worker-platform.js'

export interface WorkerShutdownDependencies {
  readonly timeoutMs: number
  getStartupOperation(): Promise<void> | undefined
  getPlatform(): WorkerPlatform | undefined
  closeCacheRedis(timeoutMs: number): Promise<void>
  closeCoordinationRedis(timeoutMs: number): Promise<void>
  closePostgres(timeoutMs: number): Promise<void>
  recordFailure(message: string, error: unknown): void
  recordTimeout(): void
  markFailed(): void
}

export function createWorkerShutdownCoordinator(
  dependencies: WorkerShutdownDependencies,
): () => Promise<void> {
  let shutdown: Promise<void> | undefined
  return () => (shutdown ??= runWorkerShutdown(dependencies))
}

async function runWorkerShutdown(dependencies: WorkerShutdownDependencies): Promise<void> {
  const deadline = createShutdownDeadline(dependencies.timeoutMs, () => {
    dependencies.recordTimeout()
    dependencies.markFailed()
  })
  try {
    const startup = dependencies.getStartupOperation()
    if (startup) await waitForShutdownOperation(startup, deadline.signal)
    const platform = dependencies.getPlatform()
    if (platform) {
      const result = await waitForShutdownOperation(
        platform.close(deadline.remaining()),
        deadline.signal,
      )
      if (result.status === 'aborted') forceClosePlatform(platform, dependencies)
      handlePlatformResult(result, deadline, dependencies)
    }
    await runStep(
      deadline,
      'Worker cache Redis shutdown failed',
      () => dependencies.closeCacheRedis(deadline.remaining()),
      dependencies,
    )
    await runStep(
      deadline,
      'Worker coordination Redis shutdown failed',
      () => dependencies.closeCoordinationRedis(deadline.remaining()),
      dependencies,
    )
    await runStep(
      deadline,
      'Worker PostgreSQL shutdown failed',
      () => dependencies.closePostgres(deadline.remaining()),
      dependencies,
    )
  } finally {
    deadline.dispose()
  }
}

function forceClosePlatform(
  platform: WorkerPlatform,
  dependencies: WorkerShutdownDependencies,
): void {
  try {
    platform.forceClose()
  } catch (error) {
    dependencies.recordFailure('Worker platform force shutdown failed', error)
    dependencies.markFailed()
  }
}

function handlePlatformResult(
  result: ShutdownOperationResult<WorkerPlatformCloseResult>,
  deadline: ShutdownDeadline,
  dependencies: WorkerShutdownDependencies,
) {
  if (result.status === 'fulfilled' && result.value.timedOut) deadline.expire()
  if (result.status !== 'rejected') return
  dependencies.recordFailure('Worker platform shutdown failed', result.reason)
  dependencies.markFailed()
}

async function runStep(
  deadline: ShutdownDeadline,
  failureMessage: string,
  operation: () => Promise<void>,
  dependencies: WorkerShutdownDependencies,
) {
  const result = await waitForShutdownOperation(operation(), deadline.signal)
  if (result.status !== 'rejected') return
  dependencies.recordFailure(failureMessage, result.reason)
  dependencies.markFailed()
}
