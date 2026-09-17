export type AssetLocationType = 'station' | 'solar_system' | 'item' | 'other'

export interface AssetSourceRecord {
  item_id: number
  type_id: number
  quantity: number
  is_singleton: boolean
  is_blueprint_copy?: boolean
  location_id: number
  location_type: AssetLocationType
  location_flag: string
}

export interface AssetSnapshot {
  itemId: number
  typeId: number
  quantity: number
  isSingleton: boolean
  isBlueprintCopy: boolean | null
  locationId: number
  locationType: AssetLocationType
  locationFlag: string
  parentItemId: number | null
}

export interface AssetTypeProjection {
  typeName: string
  groupId: number | null
  groupName: string | null
  categoryId: number | null
  categoryName: string | null
  unitVolume: number | null
}

export interface AssetLocationProjection {
  name: string | null
  solarSystemId: number | null
  solarSystemSecurityStatus: number | null
}

export interface ProjectedAsset extends AssetSnapshot, AssetTypeProjection {
  totalVolume: number | null
  customName: string | null
  locationName: string | null
  solarSystemId: number | null
  solarSystemSecurityStatus: number | null
}

export function projectAssetSnapshot(asset: AssetSourceRecord): AssetSnapshot {
  return {
    itemId: asset.item_id,
    typeId: asset.type_id,
    quantity: asset.quantity,
    isSingleton: asset.is_singleton,
    isBlueprintCopy: asset.is_blueprint_copy ?? null,
    locationId: asset.location_id,
    locationType: asset.location_type,
    locationFlag: asset.location_flag,
    parentItemId: asset.location_type === 'item' ? asset.location_id : null,
  }
}

export function projectAsset(
  asset: AssetSnapshot,
  type: AssetTypeProjection | undefined,
  customName: string | undefined,
  location: AssetLocationProjection | undefined,
): ProjectedAsset {
  const projectedType = type ?? unknownAssetType(asset.typeId)
  return {
    ...asset,
    ...projectedType,
    totalVolume: assetTotalVolume(projectedType.unitVolume, asset.quantity),
    customName: customName ?? null,
    locationName: location?.name ?? null,
    solarSystemId: location?.solarSystemId ?? null,
    solarSystemSecurityStatus: location?.solarSystemSecurityStatus ?? null,
  }
}

export function unknownAssetType(typeId: number): AssetTypeProjection {
  return {
    typeName: `Unknown type ${typeId}`,
    groupId: null,
    groupName: null,
    categoryId: null,
    categoryName: null,
    unitVolume: null,
  }
}

function assetTotalVolume(unitVolume: number | null, quantity: number) {
  if (unitVolume === null || !Number.isFinite(quantity) || quantity <= 0) return null
  const total = unitVolume * quantity
  return Number.isFinite(total) ? total : null
}
