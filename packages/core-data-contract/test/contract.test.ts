import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CORE_DATA_CONTRIBUTION_CONTEXTS,
  CORE_DATA_PRODUCT_CONTRACTS,
  CORE_DATA_PRODUCT_IDS,
  type CoreDataMethodsFor,
  type CoreDataProductRequest,
  type CoreDataProductResult,
  type PublishedSkillCatalogueResult,
  type PublishedTypeDetailsRequest,
  type PublishedTypeGroupsRequest,
  type PublishedTypeGroupsResult,
  type StaticLocationLabelsRequest,
} from '../src/index.js'

describe('core-data contract', () => {
  it('has unique stable product identities and complete policies', () => {
    expect(new Set(CORE_DATA_PRODUCT_IDS).size).toBe(CORE_DATA_PRODUCT_IDS.length)
    expect(Object.keys(CORE_DATA_PRODUCT_CONTRACTS).toSorted()).toEqual(
      CORE_DATA_PRODUCT_IDS.toSorted(),
    )

    for (const productId of CORE_DATA_PRODUCT_IDS) {
      const contract = CORE_DATA_PRODUCT_CONTRACTS[productId]
      expect(contract.id).toBe(productId)
      expect(contract.dtoVersion).toBeGreaterThan(0)
      expect(contract.requestBound).toBeGreaterThan(0)
      expect(contract.permittedContexts.length).toBeGreaterThan(0)
      expect(
        contract.permittedContexts.every((context) =>
          CORE_DATA_CONTRIBUTION_CONTEXTS.includes(context),
        ),
      ).toBe(true)
    }
  })

  it('maps product requests, results, and methods exactly', () => {
    expectTypeOf<
      CoreDataProductRequest<'published-type-groups'>
    >().toEqualTypeOf<PublishedTypeGroupsRequest>()
    expectTypeOf<
      CoreDataProductResult<'published-type-groups'>
    >().toEqualTypeOf<PublishedTypeGroupsResult>()
    expectTypeOf<CoreDataMethodsFor<readonly ['published-type-groups']>>().toHaveProperty(
      'publishedTypeGroups',
    )
    expectTypeOf<
      CoreDataProductResult<'published-skill-catalogue'>
    >().toEqualTypeOf<PublishedSkillCatalogueResult>()
    expectTypeOf<
      CoreDataProductRequest<'published-type-details'>
    >().toEqualTypeOf<PublishedTypeDetailsRequest>()
    expectTypeOf<
      CoreDataProductRequest<'static-location-labels'>
    >().toEqualTypeOf<StaticLocationLabelsRequest>()
    expectTypeOf<
      CoreDataMethodsFor<
        readonly ['published-skill-catalogue', 'published-type-details', 'static-location-labels']
      >
    >().toMatchObjectType<{
      publishedSkillCatalogue: unknown
      publishedTypeDetails: unknown
      staticLocationLabels: unknown
    }>()
  })

  it('versions the complete omission result DTO', () => {
    const contract = CORE_DATA_PRODUCT_CONTRACTS['published-type-groups']

    expect(contract.dtoVersion).toBe(1)
    expectTypeOf<PublishedTypeGroupsResult['complete']>().toEqualTypeOf<true>()
    expectTypeOf<PublishedTypeGroupsResult['revision']>().toMatchObjectType<{
      buildNumber: number
      ingestVersion: number
      ingestedAt: string
    }>()
  })
})
