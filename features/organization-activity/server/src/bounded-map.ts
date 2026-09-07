export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  operation: (item: Item) => Promise<Result>,
  signal?: AbortSignal,
): Promise<Result[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error('Invalid concurrency limit')
  let nextIndex = 0
  let failed = false
  const results: Result[] = []
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        if (failed) return
        signal?.throwIfAborted()
        const index = nextIndex++
        // A worker must finish its current read before taking another.
        // oxlint-disable-next-line no-await-in-loop
        results[index] = await operation(items[index]!).catch((error: unknown) => {
          failed = true
          throw error
        })
      }
    }),
  )
  return results
}
