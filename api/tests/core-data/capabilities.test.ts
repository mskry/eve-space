import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadPublishedSkillCatalogueProduct: vi.fn(),
  loadPublishedTypeDetailsProduct: vi.fn(),
  loadPublishedTypeGroupsProduct: vi.fn(),
  loadStaticLocationLabelsProduct: vi.fn(),
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

import { createCoreDataCapability } from '../../src/core-data/capabilities.js'

describe('core-data capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadPublishedTypeGroupsProduct.mockResolvedValue({
      rows: [],
      revision: { buildNumber: 1, ingestVersion: 1, ingestedAt: '2026-09-01T12:00:00Z' },
      complete: true,
    })
    for (const mock of [
      mocks.loadPublishedSkillCatalogueProduct,
      mocks.loadPublishedTypeDetailsProduct,
      mocks.loadStaticLocationLabelsProduct,
    ])
      mock.mockResolvedValue({
        rows: [],
        revision: { buildNumber: 1, ingestVersion: 1, ingestedAt: '2026-09-01T12:00:00Z' },
        complete: true,
      })
  })

  test('binds each new product to only its declared method', () => {
    expect(
      Object.keys(
        createCoreDataCapability(
          ['published-skill-catalogue', 'published-type-details', 'static-location-labels'],
          'resource-projection',
        ),
      ),
    ).toEqual(['publishedSkillCatalogue', 'publishedTypeDetails', 'staticLocationLabels'])
  })

  test('contains only methods declared for the active contribution', async () => {
    expect(createCoreDataCapability([], 'route')).toEqual({})
    const capability = createCoreDataCapability(['published-type-groups'], 'route')

    expect(Object.keys(capability)).toEqual(['publishedTypeGroups'])
    expect(mocks.loadPublishedTypeGroupsProduct).not.toHaveBeenCalled()
    await capability.publishedTypeGroups({ typeIds: [34] })
    expect(mocks.loadPublishedTypeGroupsProduct).toHaveBeenCalledWith({ typeIds: [34] })
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
})
