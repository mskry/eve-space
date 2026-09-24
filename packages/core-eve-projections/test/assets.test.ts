import { describe, expect, test } from 'vitest'
import { projectAsset, projectAssetSnapshot } from '../src/assets.js'

describe('asset projection', () => {
  test('projects canonical fields and deterministic unknown enrichment', () => {
    const snapshot = projectAssetSnapshot({
      is_singleton: true,
      item_id: 9,
      location_flag: 'Cargo',
      location_id: 8,
      location_type: 'item',
      quantity: 2,
      type_id: 34,
    })

    expect(projectAsset(snapshot, undefined, undefined, undefined)).toStrictEqual({
      categoryId: null,
      categoryName: null,
      customName: null,
      groupId: null,
      groupName: null,
      isBlueprintCopy: null,
      isSingleton: true,
      itemId: 9,
      locationFlag: 'Cargo',
      locationId: 8,
      locationName: null,
      locationType: 'item',
      parentItemId: 8,
      quantity: 2,
      solarSystemId: null,
      solarSystemSecurityStatus: null,
      totalVolume: null,
      typeId: 34,
      typeName: 'Unknown type 34',
      unitVolume: null,
    })
  })

  test('combines safe type, name, and static-location projection', () => {
    const snapshot = projectAssetSnapshot({
      is_singleton: false,
      item_id: 10,
      location_flag: 'Hangar',
      location_id: 30_000_142,
      location_type: 'solar_system',
      quantity: 4,
      type_id: 35,
    })
    expect(
      projectAsset(
        snapshot,
        {
          categoryId: 4,
          categoryName: 'Material',
          groupId: 18,
          groupName: 'Mineral',
          typeName: 'Tritanium',
          unitVolume: 0.01,
        },
        'Reserve',
        { name: 'Jita', solarSystemId: 30_000_142, solarSystemSecurityStatus: 0.95 },
      ),
    ).toMatchObject({ customName: 'Reserve', locationName: 'Jita', totalVolume: 0.04 })
  })
})
