import type { RecordSectionNavigationEntry } from '../types/record-navigation'

interface CharacterNavigationSource {
  readonly navigationId: string
  readonly label: string
  readonly to: string
}

export const CORE_CHARACTER_DATA_PREFETCH_IDS = [
  'core-character-skills',
  'core-character-wallet',
  'core-character-history',
] as const

export function resolveCharacterNavigation(
  entries: readonly CharacterNavigationSource[],
  characterId: number | undefined,
): readonly RecordSectionNavigationEntry[] {
  if (characterId === undefined) return []
  const recordRoot = `/characters/${characterId}`
  return entries.map((entry) => ({
    id: entry.navigationId,
    label: entry.label.toUpperCase(),
    to: entry.to.replaceAll(':characterId', String(characterId)),
    exact: entry.to === '/characters/:characterId' || entry.to === recordRoot,
  }))
}

export function findActiveCharacterNavigationEntry(
  entries: readonly RecordSectionNavigationEntry[],
  routePath: string,
) {
  const currentPath = routePath.length > 1 ? routePath.replace(/\/$/, '') : routePath
  return entries
    .filter((entry) => {
      const targetPath = entry.to.length > 1 ? entry.to.replace(/\/$/, '') : entry.to
      return entry.exact
        ? currentPath === targetPath
        : currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
    })
    .toSorted((left, right) => right.to.length - left.to.length)[0]
}

export function hasCoreCharacterDataPrefetch(navigationId: string) {
  return (CORE_CHARACTER_DATA_PREFETCH_IDS as readonly string[]).includes(navigationId)
}
