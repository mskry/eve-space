export interface ShutdownDeadline {
  readonly signal: AbortSignal
  readonly timedOut: boolean
  expire(): void
  remaining(): number
  dispose(): void
}

export type ShutdownOperationResult<T> =
  | { status: 'aborted' }
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown }

export function createShutdownDeadline(timeoutMs: number, onTimeout: () => void): ShutdownDeadline {
  const controller = new AbortController()
  const expiresAt = Date.now() + timeoutMs
  let timedOut = false
  const expire = () => {
    if (timedOut) return
    timedOut = true
    onTimeout()
    controller.abort()
  }
  const timer = setTimeout(expire, timeoutMs)

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut
    },
    expire,
    remaining: () => (timedOut ? 0 : Math.max(0, expiresAt - Date.now())),
    dispose: () => clearTimeout(timer),
  }
}

export function markProcessShutdownFailed(): void {
  process.exitCode = 1
}

export async function waitForAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  signal.throwIfAborted()
  let rejectAbort!: (reason: unknown) => void
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => rejectAbort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  operation.catch(() => {})
  try {
    return await Promise.race([operation, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export async function waitForShutdownOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<ShutdownOperationResult<T>> {
  const settled = operation.then<ShutdownOperationResult<T>, ShutdownOperationResult<T>>(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  )
  if (signal.aborted) return { status: 'aborted' }

  let onAbort: (() => void) | undefined
  const aborted = new Promise<ShutdownOperationResult<T>>((resolve) => {
    onAbort = () => resolve({ status: 'aborted' })
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([settled, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
