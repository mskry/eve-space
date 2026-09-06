import {
  platformNavigationPlacements,
  type PlatformNavigationDefault,
  type PlatformNavigationPlacement,
} from '@eve-space/platform-module-contract'

type NavigationIdentity = Pick<PlatformNavigationDefault, 'ownerId' | 'navigationId'>

export interface ShellNavigationOrder {
  readonly dashboard: readonly NavigationIdentity[]
  readonly character: readonly NavigationIdentity[]
}

export interface NavigationOrderRow {
  readonly owner_id: string
  readonly navigation_id: string
  readonly position: number
}

export function resolveShellNavigationOrder(
  defaults: readonly PlatformNavigationDefault[],
  rows: readonly NavigationOrderRow[],
  availableOwners: ReadonlySet<string>,
): ShellNavigationOrder {
  const positions = new Map(
    rows.map((row) => [navigationKey(row.owner_id, row.navigation_id), row.position]),
  )
  const defaultRanks = new Map(
    defaults.map((entry, index) => [navigationKey(entry.ownerId, entry.navigationId), index]),
  )
  const resolvePlacement = (placement: PlatformNavigationPlacement) =>
    defaults
      .filter((entry) => entry.placement === placement && availableOwners.has(entry.ownerId))
      .toSorted((left, right) => {
        const leftPosition = positions.get(navigationKey(left.ownerId, left.navigationId))
        const rightPosition = positions.get(navigationKey(right.ownerId, right.navigationId))
        if (leftPosition !== undefined && rightPosition !== undefined)
          return (
            leftPosition - rightPosition ||
            defaultRank(left, defaultRanks) - defaultRank(right, defaultRanks)
          )
        if (leftPosition !== undefined) return -1
        if (rightPosition !== undefined) return 1
        return defaultRank(left, defaultRanks) - defaultRank(right, defaultRanks)
      })
      .map(({ ownerId, navigationId }) => ({ ownerId, navigationId }))
  return {
    dashboard: resolvePlacement('dashboard'),
    character: resolvePlacement('character'),
  }
}

export function isCompleteShellNavigationOrder(
  order: ShellNavigationOrder,
  defaults: readonly PlatformNavigationDefault[],
) {
  const expected = new Map(
    defaults.map(({ ownerId, navigationId, placement }) => [
      navigationKey(ownerId, navigationId),
      placement,
    ]),
  )
  const submitted = new Set<string>()
  for (const placement of platformNavigationPlacements) {
    for (const { ownerId, navigationId } of order[placement]) {
      const key = navigationKey(ownerId, navigationId)
      if (submitted.has(key) || expected.get(key) !== placement) return false
      submitted.add(key)
    }
  }
  return submitted.size === expected.size
}

function defaultRank(entry: NavigationIdentity, ranks: ReadonlyMap<string, number>) {
  return ranks.get(navigationKey(entry.ownerId, entry.navigationId)) ?? Number.MAX_SAFE_INTEGER
}

function navigationKey(ownerId: string, navigationId: string) {
  return `${ownerId}\0${navigationId}`
}
