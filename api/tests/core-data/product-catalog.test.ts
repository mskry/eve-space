import { describe, expect, test } from 'vitest'
import {
  assertCoreDataProductCatalogConfiguration,
  coreDataProductCatalog,
  getCoreDataProductDefinition,
} from '../../src/core-data/product-catalog.js'

describe('core-data product catalog', () => {
  test('binds every product to one executable policy', () => {
    expect(() => assertCoreDataProductCatalogConfiguration()).not.toThrow()
    expect(getCoreDataProductDefinition('published-type-groups')).toMatchObject({
      method: 'publishedTypeGroups',
      sourceAuthority: 'official-sde',
      revisionStrategy: 'committed-sde-projection',
      networkAllowed: false,
    })
  })

  test.each([
    [[], 'Missing core-data product adapter'],
    [[...coreDataProductCatalog, coreDataProductCatalog[0]], 'Duplicate core-data product'],
    [[{ ...coreDataProductCatalog[0], id: 'unknown' }], 'Unknown core-data product'],
    [[{ ...coreDataProductCatalog[0], adapter: undefined }], 'Missing core-data product adapter'],
    [[{ ...coreDataProductCatalog[0], dtoVersion: 2 }], 'DTO version drift'],
    [[{ ...coreDataProductCatalog[0], requestBound: 499 }], 'request bound drift'],
    [[{ ...coreDataProductCatalog[0], sourceAuthority: 'esi' }], 'source authority'],
    [[{ ...coreDataProductCatalog[0], revisionStrategy: 'none' }], 'revision strategy'],
    [[{ ...coreDataProductCatalog[0], availabilityBehavior: 'stale' }], 'availability behavior'],
    [[{ ...coreDataProductCatalog[0], permittedContexts: ['route'] }], 'context policy drift'],
    [[{ ...coreDataProductCatalog[0], networkAllowed: true }], 'cannot allow network access'],
  ])('rejects invalid executable declarations', (catalog, message) => {
    expect(() => assertCoreDataProductCatalogConfiguration(catalog)).toThrow(message)
  })
})
