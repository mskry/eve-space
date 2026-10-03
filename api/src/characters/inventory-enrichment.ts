import type { NormalizedInventoryItem } from '@eve-space/core-eve-projections/asset-inventory'
import type { PlatformInventoryLocation } from '@eve-space/platform-module-contract/inventory'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeCategories, sdeGroups, sdeTypes } from '../db/schema.js'
import { resolveUniverseNamesBestEffort } from '../universe/names.js'
import { getStaticLocations } from '../universe/static-locations.js'
import type { CharacterAssetWindowWork } from './asset-work.js'

interface InventoryTypeEnrichment {
  readonly typeName: string
  readonly groupId: number | null
  readonly categoryId: number | null
}

export interface InventoryEnrichment {
  readonly types: ReadonlyMap<number, InventoryTypeEnrichment>
  readonly locations: ReadonlyMap<string, PlatformInventoryLocation>
}

const loadTypes = async (
  items: readonly NormalizedInventoryItem[],
  work: CharacterAssetWindowWork,
) => {
  const ids = [...new Set(items.map((item) => item.typeId))].toSorted((left, right) => left - right)
  if (ids.length === 0) return new Map<number, InventoryTypeEnrichment>()
  try {
    const rows = await work.run(() =>
      db
        .select({
          typeId: sdeTypes.typeId,
          typeName: sdeTypes.name,
          groupId: sdeTypes.groupId,
          categoryId: sdeCategories.categoryId,
        })
        .from(sdeTypes)
        .leftJoin(sdeGroups, eq(sdeGroups.groupId, sdeTypes.groupId))
        .leftJoin(sdeCategories, eq(sdeCategories.categoryId, sdeGroups.categoryId))
        .where(inArray(sdeTypes.typeId, ids))
        .limit(ids.length),
    )
    return new Map(rows.map((row) => [row.typeId, row]))
  } catch {
    work.signal.throwIfAborted()
    return new Map<number, InventoryTypeEnrichment>()
  }
}

const loadLocations = async (
  items: readonly NormalizedInventoryItem[],
  work: CharacterAssetWindowWork,
) => {
  const roots = [...new Map(items.map((item) => [item.root.key, item.root])).values()]
  const requests = roots.flatMap((root) =>
    root.id !== null && (root.kind === 'station' || root.kind === 'solar_system')
      ? [{ id: root.id, type: root.kind }]
      : [],
  )
  const [names, details] = await Promise.all([
    resolveUniverseNamesBestEffort(
      requests.map((request) => request.id),
      { signal: work.signal, work },
    ).catch(() => ({ names: new Map(), complete: false })),
    requests.length === 0
      ? []
      : work.run(() => getStaticLocations(requests, { signal: work.signal })).catch(() => []),
  ])
  work.signal.throwIfAborted()
  const staticLocations = new Map(
    details.map((location) => [`${location.type}:${location.id}`, location]),
  )
  return new Map<string, PlatformInventoryLocation>(
    roots.map((root) => {
      const named = root.id === null ? undefined : names.names.get(root.id)
      const name =
        (named?.category === root.kind ? named?.name : null) ??
        staticLocations.get(root.key)?.name ??
        null
      let state: PlatformInventoryLocation['state'] =
        root.state === 'known' ? 'unknown' : root.state
      if (root.state === 'known' && name !== null) state = 'resolved'
      return [root.key, { key: root.key, id: root.id?.toString() ?? null, state, name }]
    }),
  )
}

export const enrichInventoryItems = async (
  items: readonly NormalizedInventoryItem[],
  work: CharacterAssetWindowWork,
): Promise<InventoryEnrichment> => {
  work.signal.throwIfAborted()
  const [types, locations] = await Promise.all([loadTypes(items, work), loadLocations(items, work)])
  work.signal.throwIfAborted()
  return { types, locations }
}
