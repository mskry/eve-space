import {
  createShutdownDeadline,
  waitForShutdownOperation,
  type ShutdownDeadline,
} from './shutdown-deadline.js'

export interface ApiHttpServer {
  close(callback: (error?: Error) => void): void
  closeAllConnections(): void
}

export interface ApiShutdownDependencies {
  readonly timeoutMs: number
  getServer(): ApiHttpServer | undefined
  closeCacheRedis(timeoutMs: number): Promise<void>
  closeCoordinationRedis(timeoutMs: number): Promise<void>
  closePostgres(timeoutMs: number): Promise<void>
  recordFailure(message: string, error: unknown): void
  recordTimeout(): void
  markFailed(): void
}

export function createApiShutdownCoordinator(
  dependencies: ApiShutdownDependencies,
): () => Promise<void> {
  let shutdown: Promise<void> | undefined
  return () => (shutdown ??= runApiShutdown(dependencies))
}

async function runApiShutdown(dependencies: ApiShutdownDependencies): Promise<void> {
  const deadline = createShutdownDeadline(dependencies.timeoutMs, () => {
    dependencies.recordTimeout()
    dependencies.markFailed()
  })
  try {
    await runStep(
      deadline,
      'API HTTP server shutdown failed',
      () => closeHttpServer(dependencies.getServer(), deadline.signal),
      dependencies,
    )
    await runStep(
      deadline,
      'API cache Redis shutdown failed',
      () => dependencies.closeCacheRedis(deadline.remaining()),
      dependencies,
    )
    await runStep(
      deadline,
      'API coordination Redis shutdown failed',
      () => dependencies.closeCoordinationRedis(deadline.remaining()),
      dependencies,
    )
    await runStep(
      deadline,
      'API PostgreSQL shutdown failed',
      () => dependencies.closePostgres(deadline.remaining()),
      dependencies,
    )
  } finally {
    deadline.dispose()
  }
}

async function runStep(
  deadline: ShutdownDeadline,
  failureMessage: string,
  operation: () => Promise<void>,
  dependencies: ApiShutdownDependencies,
) {
  const result = await waitForShutdownOperation(operation(), deadline.signal)
  if (result.status !== 'rejected') return
  dependencies.recordFailure(failureMessage, result.reason)
  dependencies.markFailed()
}

function closeHttpServer(server: ApiHttpServer | undefined, signal: AbortSignal): Promise<void> {
  if (!server) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', forceClose)
      if (error) reject(error)
      else resolve()
    }
    const forceClose = () => {
      server.closeAllConnections()
      finish()
    }
    signal.addEventListener('abort', forceClose, { once: true })
    try {
      server.close(finish)
      if (signal.aborted) forceClose()
    } catch (error) {
      finish(error instanceof Error ? error : new Error('HTTP server close failed'))
    }
  })
}
