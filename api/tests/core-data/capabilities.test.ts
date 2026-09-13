import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadPublishedTypeGroupsProduct: vi.fn(),
}))

vi.mock('../../src/core-data/published-type-groups-adapter.js', () => ({
  loadPublishedTypeGroupsProduct: mocks.loadPublishedTypeGroupsProduct,
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
