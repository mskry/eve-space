import { describe, expect, test } from 'vitest'
import { projectAsset, projectAssetSnapshot } from '../src/assets.js'

describe('asset projection', () => {
  test('projects canonical fields and deterministic unknown enrichment', () => {
    const snapshot = projectAssetSnapshot({
      item_id: 9,
      type_id: 34,
      quantity: 2,
      is_singleton: true,
      location_id: 8,
      location_type: 'item',
      location_flag: 'Cargo',
    })

    expect(projectAsset(snapshot, undefined, undefined, undefined)).toEqual({
      itemId: 9,
      typeId: 34,
      quantity: 2,
      isSingleton: true,
      isBlueprintCopy: null,
      locationId: 8,
      locationType: 'item',
      locationFlag: 'Cargo',
      parentItemId: 8,
      typeName: 'Unknown type 34',
      groupId: null,
      groupName: null,
      categoryId: null,
      categoryName: null,
      unitVolume: null,
      totalVolume: null,
      customName: null,
      locationName: null,
      solarSystemId: null,
      solarSystemSecurityStatus: null,
    })
  })

  test('combines safe type, name, and static-location projection', () => {
    const snapshot = projectAssetSnapshot({
      item_id: 10,
      type_id: 35,
      quantity: 4,
      is_singleton: false,
      location_id: 30_000_142,
      location_type: 'solar_system',
      location_flag: 'Hangar',
    })
    expect(
      projectAsset(
        snapshot,
        {
          typeName: 'Tritanium',
          groupId: 18,
          groupName: 'Mineral',
          categoryId: 4,
          categoryName: 'Material',
          unitVolume: 0.01,
        },
        'Reserve',
        { name: 'Jita', solarSystemId: 30_000_142, solarSystemSecurityStatus: 0.95 },
      ),
    ).toMatchObject({ totalVolume: 0.04, customName: 'Reserve', locationName: 'Jita' })
  })
})
