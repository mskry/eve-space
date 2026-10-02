export const waitForRead = <Result>(
  operation: Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> => {
  if (!signal) return operation
  return new Promise<Result>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}
