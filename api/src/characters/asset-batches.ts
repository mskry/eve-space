const characterAssetWorkerConcurrency = 4

export const mapAssetBatchesSettled = async <Item, Result>(
  items: readonly Item[],
  load: (item: Item) => Promise<Result>,
) => {
  const results: PromiseSettledResult<Result>[] = []
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(characterAssetWorkerConcurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        try {
          // oxlint-disable-next-line no-await-in-loop
          results[index] = { status: 'fulfilled', value: await load(items[index]!) }
        } catch (reason) {
          results[index] = { reason, status: 'rejected' }
        }
      }
    },
  )
  await Promise.all(workers)
  return results
}

export const mapAssetBatches = async <Item, Result>(
  items: readonly Item[],
  load: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
  const results = await mapAssetBatchesSettled(items, load)
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
}
