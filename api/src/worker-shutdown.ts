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
  closeEsiRuntime(): Promise<void>
  closeCacheRedis(timeoutMs: number): Promise<void>
  closeCoordinationRedis(timeoutMs: number): Promise<void>
  closePostgres(timeoutMs: number): Promise<void>
  recordFailure(component: WorkerShutdownComponent, error: unknown): void
  recordTimeout(): void
  markFailed(): void
}

type WorkerShutdownComponent =
  | 'platform'
  | 'platform-force'
  | 'esi-runtime'
  | 'cache-redis'
  | 'coordination-redis'
  | 'postgres'

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
    if (startup) {
      await waitForShutdownOperation(startup, deadline.signal)
    }
    const platform = dependencies.getPlatform()
    if (platform) {
      const result = await waitForShutdownOperation(
        platform.close(deadline.remaining()),
        deadline.signal,
      )
      if (result.status === 'aborted') {
        forceClosePlatform(platform, dependencies)
      }
      handlePlatformResult(result, deadline, dependencies)
    }
    await runStep(deadline, 'esi-runtime', dependencies.closeEsiRuntime, dependencies)
    await runStep(
      deadline,
      'cache-redis',
      () => dependencies.closeCacheRedis(deadline.remaining()),
      dependencies,
    )
    await runStep(
      deadline,
      'coordination-redis',
      () => dependencies.closeCoordinationRedis(deadline.remaining()),
      dependencies,
    )
    await runStep(
      deadline,
      'postgres',
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
    dependencies.recordFailure('platform-force', error)
    dependencies.markFailed()
  }
}

function handlePlatformResult(
  result: ShutdownOperationResult<WorkerPlatformCloseResult>,
  deadline: ShutdownDeadline,
  dependencies: WorkerShutdownDependencies,
) {
  if (result.status === 'fulfilled' && result.value.timedOut) {
    deadline.expire()
  }
  if (result.status !== 'rejected') {
    return
  }
  dependencies.recordFailure('platform', result.reason)
  dependencies.markFailed()
}

async function runStep(
  deadline: ShutdownDeadline,
  component: WorkerShutdownComponent,
  operation: () => Promise<void>,
  dependencies: WorkerShutdownDependencies,
) {
  const result = await waitForShutdownOperation(operation(), deadline.signal)
  if (result.status !== 'rejected') {
    return
  }
  dependencies.recordFailure(component, result.reason)
  dependencies.markFailed()
}
