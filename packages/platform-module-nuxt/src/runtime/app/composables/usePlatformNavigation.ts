import { computed } from '#imports'
import type { PlatformNavigationPlacement } from '@eve-space/platform-module-contract'
import { platformNavigation } from '#build/eve-space-platform/navigation'
import { usePlatformModuleRuntime } from './usePlatformModuleRuntime.js'
import type { PlatformNavigationEntry, PlatformNavigationIdentity } from '../../navigation.js'

export function usePlatformNavigation(placement: PlatformNavigationPlacement) {
  const { enabledModuleIds, runtimeQuery } = usePlatformModuleRuntime()
  const navigation = computed(() => {
    const entries = platformNavigation.filter(
      (entry) =>
        entry.placement === placement &&
        (entry.ownerId === 'core' || enabledModuleIds.value.has(entry.ownerId)),
    )
    const order: readonly PlatformNavigationIdentity[] | undefined =
      runtimeQuery.data.value?.shellNavigationOrder[placement]
    if (!order) return entries

    const entriesById = new Map(entries.map((entry) => [entryId(entry), entry]))
    const ordered = order.flatMap((entry) => {
      const resolved = entriesById.get(entryId(entry))
      return resolved ? [resolved] : []
    })
    const orderedIds = new Set(ordered.map(entryId))
    const resolved = [...ordered]
    for (const entry of entries) {
      if (orderedIds.has(entryId(entry))) continue
      const preceding = entries
        .slice(0, entries.indexOf(entry))
        .findLast((candidate) =>
          resolved.some((resolvedEntry) => entryId(resolvedEntry) === entryId(candidate)),
        )
      const precedingIndex = preceding
        ? resolved.findIndex((candidate) => entryId(candidate) === entryId(preceding))
        : -1
      resolved.splice(precedingIndex + 1, 0, entry)
    }
    return resolved
  })

  return { navigation }
}

function entryId(entry: Pick<PlatformNavigationEntry, 'ownerId' | 'navigationId'>) {
  return `${entry.ownerId}/${entry.navigationId}`
}
