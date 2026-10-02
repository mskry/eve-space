import { describe, expect, test } from 'vitest'
import {
  assertCoreDataProductCatalogConfiguration,
  coreDataProductCatalog,
  getCoreDataProductDefinition,
} from '../../src/core-data/product-catalog.js'

const sampleProduct = getCoreDataProductDefinition('published-type-groups')

describe('core-data product catalog', () => {
  test('binds every product to one executable policy', () => {
    expect(() => assertCoreDataProductCatalogConfiguration()).not.toThrow()
    expect(getCoreDataProductDefinition('public-character-profile')).toMatchObject({
      method: 'publicCharacterProfile',
      networkAllowed: true,
      permittedContexts: ['route'],
      requestBound: 1,
      revisionStrategy: 'gateway-observation',
      sourceAuthority: 'esi-gateway',
    })
    expect(getCoreDataProductDefinition('market-catalogue')).toMatchObject({
      method: 'marketCatalogue',
      networkAllowed: false,
      permittedContexts: ['route', 'graphql-read'],
      requestBound: 32_000,
    })
    expect(getCoreDataProductDefinition('published-type-groups')).toMatchObject({
      method: 'publishedTypeGroups',
      networkAllowed: false,
      revisionStrategy: 'committed-sde-projection',
      sourceAuthority: 'official-sde',
    })
    expect(getCoreDataProductDefinition('published-skill-catalogue')).toMatchObject({
      method: 'publishedSkillCatalogue',
      networkAllowed: false,
      requestBound: 10_000,
    })
    expect(getCoreDataProductDefinition('published-type-details')).toMatchObject({
      method: 'publishedTypeDetails',
      networkAllowed: false,
      requestBound: 500,
    })
    expect(getCoreDataProductDefinition('static-location-labels')).toMatchObject({
      method: 'staticLocationLabels',
      networkAllowed: false,
      requestBound: 500,
    })
  })

  test.each([
    [[], 'Missing core-data product adapter'],
    [[null], 'Core-data catalog entries must be objects'],
    [[...coreDataProductCatalog, coreDataProductCatalog[0]], 'Duplicate core-data product'],
    [[{ ...sampleProduct, id: 'unknown' }], 'Unknown core-data product'],
    [[{ ...sampleProduct, adapter: undefined }], 'Missing core-data product adapter'],
    [[{ ...sampleProduct, method: 'unknown' }], 'method drift'],
    [[{ ...sampleProduct, audience: 'unknown' }], 'audience drift'],
    [[{ ...sampleProduct, dtoVersion: 2 }], 'DTO version drift'],
    [[{ ...sampleProduct, requestBound: 499 }], 'request bound drift'],
    [[{ ...sampleProduct, sourceAuthority: 'esi' }], 'source authority'],
    [[{ ...sampleProduct, revisionStrategy: 'none' }], 'revision strategy'],
    [[{ ...sampleProduct, availabilityBehavior: 'stale' }], 'availability behavior'],
    [[{ ...sampleProduct, permittedContexts: [null] }], 'context policy drift'],
    [[{ ...sampleProduct, permittedContexts: ['route'] }], 'context policy drift'],
    [[{ ...sampleProduct, networkAllowed: true }], 'network policy'],
    [
      [{ ...getCoreDataProductDefinition('public-character-profile'), networkAllowed: false }],
      'network policy',
    ],
  ])('rejects invalid executable declarations', (catalog, message) => {
    expect(() => assertCoreDataProductCatalogConfiguration(catalog)).toThrow(message)
  })
})
