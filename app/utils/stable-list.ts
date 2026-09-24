export interface StableListEntry<T> {
  item: T
  key: string
}

export function createStableListEntries<T>(
  identify: (item: T) => string,
  equivalent: (previous: T, current: T) => boolean = Object.is,
) {
  let previousEntries: StableListEntry<T>[] = []
  let nextKey = 0

  return (items: readonly T[]): StableListEntry<T>[] => {
    const availableEntries = new Map<string, StableListEntry<T>[]>()
    for (const entry of previousEntries) {
      const identity = identify(entry.item)
      const entries = availableEntries.get(identity)
      if (entries) {
        entries.push(entry)
      } else {
        availableEntries.set(identity, [entry])
      }
    }

    const entries = items.map((item) => ({
      identity: identify(item),
      item,
      key: undefined as string | undefined,
    }))
    for (const entry of entries) {
      const candidates = availableEntries.get(entry.identity)
      const matchingIndex =
        candidates?.findIndex((candidate) => equivalent(candidate.item, entry.item)) ?? -1
      if (!candidates || matchingIndex < 0) {
        continue
      }

      entry.key = candidates.splice(matchingIndex, 1)[0]?.key
    }

    previousEntries = entries.map((entry) => {
      const previous = availableEntries.get(entry.identity)?.shift()
      return {
        item: entry.item,
        key: entry.key ?? previous?.key ?? `${entry.identity}\u0000${nextKey++}`,
      }
    })
    return previousEntries
  }
}
