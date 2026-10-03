import type { AssetSnapshot } from './assets.js'

export type InventoryBlueprint = 'none' | 'original' | 'copy'
export type InventoryRootState = 'known' | 'restricted' | 'unresolved'

export interface InventoryPhysicalRoot {
  readonly key: string
  readonly id: number | null
  readonly kind: 'station' | 'solar_system' | 'other' | null
  readonly state: InventoryRootState
}

export interface NormalizedInventoryItem {
  readonly itemId: number
  readonly typeId: number
  readonly quantity: `${bigint}`
  readonly blueprint: InventoryBlueprint
  readonly root: InventoryPhysicalRoot
}

export interface InventoryItemObservation {
  readonly characterId: number
  readonly items: readonly NormalizedInventoryItem[]
}

const positiveId = (value: number) => Number.isSafeInteger(value) && value > 0

const normalizedQuantity = (asset: AssetSnapshot): `${bigint}` => {
  if (Number.isSafeInteger(asset.quantity) && asset.quantity > 0) return `${BigInt(asset.quantity)}`
  throw new TypeError('Inventory source contains an unsupported quantity')
}

const blueprintKind = (asset: AssetSnapshot): InventoryBlueprint => {
  if (asset.isBlueprintCopy === true) return 'copy'
  return 'none'
}

const unresolvedRoot = (): InventoryPhysicalRoot => ({
  key: 'unresolved',
  id: null,
  kind: null,
  state: 'unresolved',
})

const physicalRoot = (asset: AssetSnapshot): InventoryPhysicalRoot => {
  if (asset.locationType === 'item') return unresolvedRoot()
  const restricted = asset.locationType === 'other'
  return {
    key: `${asset.locationType}:${asset.locationId}`,
    id: asset.locationId,
    kind: asset.locationType,
    state: restricted ? 'restricted' : 'known',
  }
}

const itemSignature = (asset: AssetSnapshot) =>
  JSON.stringify([
    asset.typeId,
    asset.quantity,
    asset.isSingleton,
    asset.isBlueprintCopy,
    asset.locationId,
    asset.locationType,
    asset.locationFlag,
    asset.parentItemId,
  ])

const distinctAssets = (assets: readonly AssetSnapshot[]) => {
  const distinct = new Map<number, AssetSnapshot>()
  for (const asset of assets) {
    if (!positiveId(asset.itemId) || !positiveId(asset.typeId) || !positiveId(asset.locationId))
      throw new TypeError('Inventory source contains an unsupported identity')
    if (asset.parentItemId !== (asset.locationType === 'item' ? asset.locationId : null))
      throw new TypeError('Inventory source contains inconsistent ancestry')
    normalizedQuantity(asset)
    const previous = distinct.get(asset.itemId)
    if (previous && itemSignature(previous) !== itemSignature(asset))
      throw new TypeError('Inventory source contains conflicting duplicate items')
    distinct.set(asset.itemId, asset)
  }
  return distinct
}

const resolveRoot = (
  first: AssetSnapshot,
  assets: ReadonlyMap<number, AssetSnapshot>,
  roots: Map<number, InventoryPhysicalRoot>,
) => {
  const chain: number[] = []
  const seen = new Set<number>()
  let current: AssetSnapshot | undefined = first
  let root = unresolvedRoot()
  while (current) {
    if (seen.has(current.itemId)) break
    const cached = roots.get(current.itemId)
    if (cached) {
      root = cached
      break
    }
    seen.add(current.itemId)
    chain.push(current.itemId)
    if (current.parentItemId === null) {
      root = physicalRoot(current)
      break
    }
    current = assets.get(current.parentItemId)
  }
  for (const itemId of chain) roots.set(itemId, root)
  return root
}

export const normalizeInventoryObservation = (
  assets: readonly AssetSnapshot[],
): readonly NormalizedInventoryItem[] => {
  const distinct = distinctAssets(assets)
  const roots = new Map<number, InventoryPhysicalRoot>()
  return [...distinct.values()]
    .toSorted((left, right) => left.itemId - right.itemId)
    .map((asset) => ({
      itemId: asset.itemId,
      typeId: asset.typeId,
      quantity: normalizedQuantity(asset),
      blueprint: blueprintKind(asset),
      root: resolveRoot(asset, distinct, roots),
    }))
}

export const excludeInventoryConflicts = (observations: readonly InventoryItemObservation[]) => {
  const owners = new Map<number, Set<number>>()
  for (const observation of observations) {
    for (const item of observation.items) {
      const holders = owners.get(item.itemId) ?? new Set<number>()
      holders.add(observation.characterId)
      owners.set(item.itemId, holders)
    }
  }
  const conflictingItems = new Set(
    [...owners].filter(([, holders]) => holders.size > 1).map(([id]) => id),
  )
  const conflictingCharacters = new Set<number>()
  const clean = observations.map((observation) => ({
    characterId: observation.characterId,
    items: observation.items.filter((item) => {
      if (!conflictingItems.has(item.itemId)) return true
      conflictingCharacters.add(observation.characterId)
      return false
    }),
  }))
  return { observations: clean, conflictingCharacters, conflictingItems }
}

export const sumInventoryQuantities = (quantities: readonly `${bigint}`[]): `${bigint}` =>
  `${quantities.reduce((sum, quantity) => sum + BigInt(quantity), 0n)}`
