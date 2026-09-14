export async function executeCancellableQuery<Result>(
  query: Promise<Result> & { cancel(): void },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (!signal) return query

  const cancel = () => query.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    return await query
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
