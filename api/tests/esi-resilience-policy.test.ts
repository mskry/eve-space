import { describe, expect, test } from 'vitest'
import {
  esiMetadataReview,
  esiOperationMetadata,
} from '../src/esi-resilience/operation-metadata.js'
import {
  assertEsiOperationCatalogConfiguration,
  assertRegisteredEsiOperation,
  esiOperationCatalog,
  getEsiOperationContract,
} from '../src/esi-resilience/catalog.js'

describe('ESI operation policies', () => {
  test('declares every backend ESI operation with quota behavior', () => {
    expect(Object.keys(esiOperationCatalog)).toEqual(
      expect.arrayContaining([
        'status',
        'public-character',
        'public-corporation',
        'public-alliance',
        'universe-races',
        'universe-bloodlines',
        'wallet-balance',
        'wallet-transactions',
        'skills',
        'location',
        'ship',
        'employment-history',
        'bulk-affiliation',
      ]),
    )
    expect(getEsiOperationContract('bulk-affiliation')).toMatchObject({
      cache: { kind: 'none' },
    })
    expect(getEsiOperationContract('public-character')).toMatchObject({
      cache: { kind: 'shared' },
    })
    expect(getEsiOperationContract('public-corporation')).toMatchObject({
      representationVersion: 'v2',
    })
    expect(esiOperationMetadata['universe-resolve-names']).toMatchObject({
      cache: { kind: 'runtime-only' },
    })
    expect(getEsiOperationContract('universe-resolve-names')).toMatchObject({
      identity: {
        kind: 'set',
        maximumItems: esiOperationMetadata['universe-resolve-names'].maximumBatchSize,
      },
      freshness: { kind: 'relative', seconds: 3_600 },
    })
    expect(getEsiOperationContract('bulk-affiliation')).toMatchObject({
      identity: {
        kind: 'set',
        maximumItems: esiOperationMetadata['bulk-affiliation'].maximumBatchSize,
      },
    })
    expect(getEsiOperationContract('wallet-balance')).toMatchObject({
      authorization: { kind: 'character', scope: 'esi-wallet.read_character_wallet.v1' },
      cache: { kind: 'shared', stale: { kind: 'none' } },
    })
  })

  test('fails closed for an unregistered operation name', () => {
    expect(() => assertRegisteredEsiOperation('new-unmetered-operation')).toThrow(
      'Unregistered ESI operation',
    )
  })

  test('keeps the runtime registry complete against the reviewed metadata fixture', () => {
    expect(esiMetadataReview).toEqual({
      explorerUrl: 'https://developers.eveonline.com/api-explorer',
      reviewedAt: '2026-08-25',
      requestedCompatibilityDate: '2026-08-23',
      resolvedCompatibilityDate: '2026-08-18',
    })
    expect(Object.keys(esiOperationCatalog).toSorted()).toEqual(
      Object.keys(esiOperationMetadata).toSorted(),
    )
  })

  test('resolves required authorization and rate-group metadata for every contract', () => {
    const resolved = []
    const expected = []
    for (const [operation, metadata] of Object.entries(esiOperationMetadata)) {
      const contract = getEsiOperationContract(operation as keyof typeof esiOperationCatalog)
      resolved.push({
        operation,
        audit: contract.audit,
        authorization: contract.authorization,
        rateGroup: contract.rateGroup,
        validRepresentationVersion: contract.representationVersion.length > 0,
        revalidate: contract.cache.kind === 'shared' ? contract.cache.revalidate : false,
      })
      expected.push({
        operation,
        audit: {
          esiOperationId: metadata.esiOperationId,
          reviewedDate: esiMetadataReview.resolvedCompatibilityDate,
        },
        authorization: metadata.requiredScope
          ? { kind: 'character', scope: metadata.requiredScope }
          : { kind: 'public' },
        rateGroup:
          metadata.rateLimit.kind === 'declared'
            ? { kind: 'declared', group: metadata.rateLimit.group }
            : { kind: 'legacy-only' },
        validRepresentationVersion: true,
        revalidate: contract.cache.kind === 'shared' && metadata.supportsConditionalRequests,
      })
    }
    expect(resolved).toEqual(expected)
  })

  test('records representative public and daily-boundary cache contracts', () => {
    expect(esiOperationMetadata['public-character']).toMatchObject({
      esiOperationId: 'GetCharactersDetail',
      minimumCompatibilityDate: '2026-06-09',
      requiredScope: null,
      cache: { kind: 'relative', seconds: 86_400 },
      rateLimit: { kind: 'legacy-only' },
    })
    expect(esiOperationMetadata['universe-solar-system']).toMatchObject({
      esiOperationId: 'GetUniverseSystemsSystemId',
      cache: { kind: 'daily-utc', hour: 11, minute: 5 },
      rateLimit: { kind: 'legacy-only' },
    })
  })

  test('records representative character route-group contracts', () => {
    expect([esiOperationMetadata.location, esiOperationMetadata.ship]).toEqual([
      expect.objectContaining({
        cache: { kind: 'relative', seconds: 5 },
        rateLimit: {
          kind: 'declared',
          group: 'char-location',
          maximumTokens: 1_200,
          window: '15m',
        },
      }),
      expect.objectContaining({
        cache: { kind: 'relative', seconds: 5 },
        rateLimit: {
          kind: 'declared',
          group: 'char-location',
          maximumTokens: 1_200,
          window: '15m',
        },
      }),
    ])
    expect(esiOperationMetadata.skills).toMatchObject({
      cache: { kind: 'relative', seconds: 60 },
      rateLimit: {
        kind: 'declared',
        group: 'char-detail',
        maximumTokens: 600,
        window: '15m',
      },
    })
    expect([
      esiOperationMetadata['wallet-balance'],
      esiOperationMetadata['wallet-transactions'],
    ]).toEqual([
      expect.objectContaining({
        cache: { kind: 'relative', seconds: 120 },
        rateLimit: {
          kind: 'declared',
          group: 'char-wallet',
          maximumTokens: 150,
          window: '15m',
        },
      }),
      expect.objectContaining({
        cache: { kind: 'relative', seconds: 3_600 },
        rateLimit: {
          kind: 'declared',
          group: 'char-wallet',
          maximumTokens: 150,
          window: '15m',
        },
      }),
    ])
  })

  test('rejects incompatible dates and missing requestable private scopes at startup', () => {
    expect(() =>
      assertEsiOperationCatalogConfiguration({
        compatibilityDate: '2026-06-08',
        ssoEnabled: false,
        requestableScopes: [],
      }),
    ).toThrow('public-character requires 2026-06-09')
    expect(() =>
      assertEsiOperationCatalogConfiguration({
        compatibilityDate: '2026-08-23',
        ssoEnabled: true,
        requestableScopes: ['esi-location.read_location.v1'],
      }),
    ).toThrow(
      'EVE_SCOPES is missing scopes required by active ESI operations: esi-location.read_ship_type.v1 esi-skills.read_skills.v1 esi-wallet.read_character_wallet.v1',
    )
  })

  test('accepts the reviewed date and configured private scopes without requiring SSO when disabled', () => {
    expect(() =>
      assertEsiOperationCatalogConfiguration({
        compatibilityDate: '2026-08-23',
        ssoEnabled: true,
        requestableScopes: [
          'esi-location.read_location.v1',
          'esi-location.read_ship_type.v1',
          'esi-skills.read_skills.v1',
          'esi-wallet.read_character_wallet.v1',
        ],
      }),
    ).not.toThrow()
    expect(() =>
      assertEsiOperationCatalogConfiguration({
        compatibilityDate: '2026-08-23',
        ssoEnabled: false,
        requestableScopes: [],
      }),
    ).not.toThrow()
  })
})
