import type { MarketGroup } from './market-catalogue-types'

export const marketGroupPath = (groups: readonly MarketGroup[], groupId: number | undefined) => {
  if (!groupId) return []
  const byId = new Map(groups.map((group) => [group.id, group]))
  const path: MarketGroup[] = []
  const visited = new Set<number>()
  let cursor: number | null = groupId
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor)
    const group: MarketGroup | undefined = byId.get(cursor)
    if (!group) return []
    path.push(group)
    cursor = group.parentId
  }
  return path.toReversed()
}

export const marketBreadcrumbs = (groups: readonly MarketGroup[], groupId: number | undefined) =>
  marketGroupPath(groups, groupId).map((group) => group.name)
