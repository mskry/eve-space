import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadMarketCatalogueProduct: vi.fn(),
  loadMarketStationRegionsProduct: vi.fn(),
  loadPublishedSkillCatalogueProduct: vi.fn(),
  loadPublishedTypeDetailsProduct: vi.fn(),
  loadPublishedTypeGroupsProduct: vi.fn(),
  loadPublicCharacterProfileProduct: vi.fn(),
  loadStaticLocationLabelsProduct: vi.fn(),
}))

vi.mock('../../src/core-data/market-catalogue-adapter.js', () => ({
  loadMarketCatalogueProduct: mocks.loadMarketCatalogueProduct,
}))
vi.mock('../../src/core-data/market-station-regions-adapter.js', () => ({
  loadMarketStationRegionsProduct: mocks.loadMarketStationRegionsProduct,
}))
vi.mock('../../src/core-data/published-type-groups-adapter.js', () => ({
  loadPublishedTypeGroupsProduct: mocks.loadPublishedTypeGroupsProduct,
}))
vi.mock('../../src/core-data/published-skill-catalogue-adapter.js', () => ({
  loadPublishedSkillCatalogueProduct: mocks.loadPublishedSkillCatalogueProduct,
}))
vi.mock('../../src/core-data/published-type-details-adapter.js', () => ({
  loadPublishedTypeDetailsProduct: mocks.loadPublishedTypeDetailsProduct,
}))
vi.mock('../../src/core-data/static-location-labels-adapter.js', () => ({
  loadStaticLocationLabelsProduct: mocks.loadStaticLocationLabelsProduct,
}))
vi.mock('../../src/core-data/public-character-profile-adapter.js', () => ({
  loadPublicCharacterProfileProduct: mocks.loadPublicCharacterProfileProduct,
}))

import { createCoreDataCapability } from '../../src/core-data/capabilities.js'

describe('core-data capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadPublishedTypeGroupsProduct.mockResolvedValue({
      complete: true,
      revision: { buildNumber: 1, ingestVersion: 1, ingestedAt: '2026-09-01T12:00:00Z' },
      rows: [],
    })
    for (const mock of [
      mocks.loadPublishedSkillCatalogueProduct,
      mocks.loadMarketStationRegionsProduct,
      mocks.loadPublishedTypeDetailsProduct,
      mocks.loadStaticLocationLabelsProduct,
    ]) {
      mock.mockResolvedValue({
        complete: true,
        revision: { buildNumber: 1, ingestVersion: 1, ingestedAt: '2026-09-01T12:00:00Z' },
        rows: [],
      })
    }
  })

  test('binds each new product to only its declared method', () => {
    expect(
      Object.keys(
        createCoreDataCapability(
          ['published-skill-catalogue', 'published-type-details', 'static-location-labels'],
          'resource-projection',
        ),
      ),
    ).toStrictEqual(['publishedSkillCatalogue', 'publishedTypeDetails', 'staticLocationLabels'])
  })

  test('contains only methods declared for the active contribution', async () => {
    expect(createCoreDataCapability([], 'route')).toStrictEqual({})
    const capability = createCoreDataCapability(['published-type-groups'], 'route')

    expect(Object.keys(capability)).toStrictEqual(['publishedTypeGroups'])
    expect(mocks.loadPublishedTypeGroupsProduct).not.toHaveBeenCalled()
    await capability.publishedTypeGroups({ typeIds: [34] })
    expect(mocks.loadPublishedTypeGroupsProduct).toHaveBeenCalledWith({ typeIds: [34] })
  })

  test('exposes the public profile only in route contexts', () => {
    const capability = createCoreDataCapability(['public-character-profile'], 'route')
    expect(Object.keys(capability)).toStrictEqual(['publicCharacterProfile'])
    expect(() =>
      createCoreDataCapability(['public-character-profile'], 'resource-projection'),
    ).toThrow('not permitted')
    expect(mocks.loadPublicCharacterProfileProduct).not.toHaveBeenCalled()
  })

  test('rejects duplicate and context-incompatible products during construction', () => {
    expect(() =>
      createCoreDataCapability(['published-type-groups', 'published-type-groups'], 'route'),
    ).toThrow('Duplicate core-data product')
    expect(() => createCoreDataCapability(['published-type-groups'], 'activity-provider')).toThrow(
      'not permitted',
    )
    expect(() => createCoreDataCapability(['unknown-product'] as never, 'route')).toThrow(
      'Unknown core-data product',
    )
    expect(mocks.loadPublishedTypeGroupsProduct).not.toHaveBeenCalled()
  })

  test('exposes the market catalogue only to a declared route', async () => {
    expect(() => createCoreDataCapability(['market-catalogue'], 'resource-projection')).toThrow(
      'not permitted',
    )
    expect(() => createCoreDataCapability(['market-catalogue'], 'activity-provider')).toThrow(
      'not permitted',
    )
    const route = createCoreDataCapability(['market-catalogue'], 'route')
    expect(Object.keys(route)).toStrictEqual(['marketCatalogue'])
    expect(mocks.loadMarketCatalogueProduct).not.toHaveBeenCalled()
    await route.marketCatalogue({ kind: 'tree' })
    expect(mocks.loadMarketCatalogueProduct).toHaveBeenCalledOnce()
  })

  test('limits station-to-region evidence to declared route and resource projections', async () => {
    expect(() => createCoreDataCapability(['market-station-regions'], 'activity-provider')).toThrow(
      'not permitted',
    )
    const resource = createCoreDataCapability(['market-station-regions'], 'resource-projection')
    expect(Object.keys(resource)).toStrictEqual(['marketStationRegions'])
    await resource.marketStationRegions({ stationIds: [60003760] })
    expect(mocks.loadMarketStationRegionsProduct).toHaveBeenCalledWith({ stationIds: [60003760] })
  })
})
