import type { MarketType } from './market-catalogue-types'

interface WorkerResult {
  item: MarketType
  score?: number
}

export interface MarketSearchWorker {
  search(query: string, options: { limit: number }): Promise<WorkerResult[]>
  terminate(): void
}

interface RankedItem {
  item: MarketType
  rank: number
  score: number
}

const normalized = (name: string) => name.toLocaleLowerCase('en')

const rankItem = (item: MarketType, query: string, score: number): RankedItem => {
  const name = normalized(item.name)
  let rank = 4
  if (String(item.id) === query || name === query) rank = 0
  else if (name.startsWith(query)) rank = 1
  else if (name.includes(query)) rank = 2
  else if (query.split(/\s+/).every((word) => name.includes(word))) rank = 3
  return { item, rank, score }
}

export const createMarketSearch = (items: readonly MarketType[], worker: MarketSearchWorker) => {
  const byId = new Map(items.map((item) => [item.id, item]))
  const byName = new Map<string, MarketType>()
  const prefixes = new Map<string, MarketType[]>()
  for (const item of items) {
    const name = normalized(item.name)
    if (!byName.has(name)) byName.set(name, item)
    for (let length = 1; length <= Math.min(3, name.length); length += 1) {
      const prefix = name.slice(0, length)
      const bucket = prefixes.get(prefix) ?? []
      bucket.push(item)
      prefixes.set(prefix, bucket)
    }
  }
  for (const [prefix, bucket] of prefixes) {
    prefixes.set(
      prefix,
      bucket.toSorted(
        (left, right) => left.name.localeCompare(right.name, 'en') || left.id - right.id,
      ),
    )
  }

  let terminated = false
  const search = async (input: string): Promise<MarketType[]> => {
    const query = normalized(input.trim()).slice(0, 80)
    if (!query || terminated) return []
    const matches = await worker.search(query, { limit: 100 })
    if (terminated) return []
    const candidates = new Map<number, RankedItem>()
    const add = (item: MarketType, score = 1) => {
      if (!candidates.has(item.id)) candidates.set(item.id, rankItem(item, query, score))
    }
    const exactId = byId.get(Number(query))
    if (exactId) add(exactId, 0)
    const exactName = byName.get(query)
    if (exactName) add(exactName, 0)
    for (const item of (prefixes.get(query.slice(0, Math.min(3, query.length))) ?? []).slice(
      0,
      100,
    )) {
      if (normalized(item.name).startsWith(query)) add(item)
    }
    for (const match of matches) add(match.item, match.score)
    return [...candidates.values()]
      .toSorted(
        (left, right) =>
          left.rank - right.rank ||
          left.score - right.score ||
          left.item.name.localeCompare(right.item.name, 'en') ||
          left.item.id - right.item.id,
      )
      .slice(0, 20)
      .map(({ item }) => item)
  }
  const dispose = () => {
    terminated = true
    worker.terminate()
  }
  return { dispose, search }
}
