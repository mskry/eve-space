import { describe, expect, test } from 'vitest'
import { operationRegistry } from '@evespace/esi-client/operations'
import {
  esiMetadataReview,
  esiOperationMetadata,
  getGeneratedEsiMaximumBatchSize,
  getGeneratedEsiOperationFacts,
} from '../../src/esi-gateway/internal/operation-metadata.js'
import {
  assertExecutableEsiOperationDefinitions,
  assertEsiOperationCatalogConfiguration,
  assertEsiOperationSdkClassifications,
  getEsiOperationContract,
} from '../../src/esi-gateway/internal/catalog-access.js'
import {
  assertEsiCatalogConfiguration,
  assertRegisteredEsiOperation,
  getCharacterEsiScope,
  getOptionalCharacterEsiScope,
} from '../../src/esi-gateway/catalog-interface.js'
import {
  coreEsiOperationCatalog,
  esiOperationCatalog,
} from '../../src/esi-gateway/internal/catalog.js'
import { assertEsiOperationContracts } from '../../src/esi-gateway/internal/catalog-validation.js'
import { classifyEsiResponse } from '../../src/esi-gateway/internal/policy.js'
import { installedModuleEsiOperationCatalog } from '../../src/generated/platform/installed-module-esi.js'

const runtimePrivateCache = {
  collapse: true,
  kind: 'shared',
  retentionMilliseconds: 0,
  runtimeRetention: 'private',
  stale: { kind: 'none' },
} as const

describe('ESI operation policies', () => {
  test('keeps GetUniverseBloodlines as the only API response-validation override', () => {
    const disabled = Object.entries(esiOperationCatalog)
      .filter(([, contract]) => contract.responseValidation.kind === 'disabled')
      .map(([operation, contract]) => [operation, contract.audit.esiOperationId])

    expect(disabled).toStrictEqual([['universe-bloodlines', 'GetUniverseBloodlines']])
  })

  test('requires definitions to own a real matching SDK descriptor and catalog contract', () => {
    const contract = {
      ...getEsiOperationContract('status'),
      audit: { esiOperationId: 'GetStatus', reviewedDate: '2026-08-18' },
    } as const
    const definition = {
      contract,
      descriptor: operationRegistry.GetStatus!,
      sdkOperationId: 'GetStatus' as const,
    }

    expect(() =>
      assertExecutableEsiOperationDefinitions(
        { 'module-operation': contract },
        { 'module-operation': definition },
      ),
    ).not.toThrow()
    expect(() =>
      assertExecutableEsiOperationDefinitions(
        { 'module-operation': contract },
        {
          'module-operation': { ...definition, descriptor: operationRegistry.GetUniverseRaces! },
        },
      ),
    ).toThrow('does not bind the registered SDK descriptor')
    expect(() =>
      assertExecutableEsiOperationDefinitions({ 'module-operation': contract }, {}),
    ).toThrow('has no executable definition')
    const wrongSubjects = {
      ...contract,
      authorization: { ...contract.authorization, subjectBindings: ['corporation_id'] as const },
    }
    expect(() =>
      assertExecutableEsiOperationDefinitions(
        { 'module-operation': wrongSubjects },
        { 'module-operation': { ...definition, contract: wrongSubjects } },
      ),
    ).toThrow('does not match generated request subjects')

    const corporationJobs =
      installedModuleEsiOperationCatalog['organization-activity-corporation-jobs']
    expect(corporationJobs.authorization).toMatchObject({
      kind: 'oauth',
      requiredRolePredicate: 'project-manager',
      subjectBindings: ['corporation_id'],
    })
    const wrongRole = {
      ...corporationJobs,
      authorization: { ...corporationJobs.authorization, requiredRolePredicate: null },
    }
    expect(() =>
      assertExecutableEsiOperationDefinitions(
        { 'module-operation': wrongRole },
        {
          'module-operation': {
            contract: wrongRole,
            descriptor: operationRegistry.GetCorporationsFreelanceJobsListing!,
            sdkOperationId: 'GetCorporationsFreelanceJobsListing',
          },
        },
      ),
    ).toThrow('does not match generated OAuth authority')
  })

  test('declares every backend ESI operation with quota behavior', () => {
    expect(Object.keys(esiOperationCatalog)).toStrictEqual(
      expect.arrayContaining([
        'status',
        'public-character',
        'public-corporation',
        'public-alliance',
        'universe-races',
        'universe-bloodlines',
        'character-assets-page',
        'character-asset-names',
        'wallet-balance',
        'wallet-journal',
        'wallet-transactions',
        'market-orders',
        'market-order-history',
        'character-contracts',
        'character-contract-items',
        'character-contract-bids',
        'mail-headers',
        'mail-message',
        'mail-labels',
        'mail-lists',
        'mail-send',
        'mail-create-label',
        'mail-update',
        'mail-delete',
        'mail-delete-label',
        'character-search',
        'character-cspa-charge',
        'attributes',
        'skill-queue',
        'character-clones',
        'character-implants',
        'skills',
        'location',
        'ship',
        'employment-history',
        'bulk-affiliation',
        'universe-resolve-ids',
      ]),
    )
    expect(getEsiOperationContract('bulk-affiliation')).toMatchObject({
      cache: { kind: 'none' },
    })
    expect(getEsiOperationContract('public-character')).toMatchObject({
      cache: { kind: 'shared' },
    })
    expect(getEsiOperationContract('public-corporation')).toMatchObject({
      representationVersion: 'v3',
    })
    expect(getEsiOperationContract('skills')).toMatchObject({
      representationVersion: 'v2',
    })
    expect(getEsiOperationContract('character-assets-page')).toMatchObject({
      representationVersion: 'v2',
    })
    expect(getEsiOperationContract('wallet-journal')).toMatchObject({
      representationVersion: 'v2',
    })
    expect(esiOperationMetadata['universe-resolve-names']).toMatchObject({
      cache: { kind: 'runtime-only' },
    })
    expect(getEsiOperationContract('universe-resolve-names')).toMatchObject({
      freshness: { kind: 'relative', seconds: 3600 },
      identity: {
        kind: 'set',
        maximumItems: getGeneratedEsiMaximumBatchSize('universe-resolve-names'),
      },
    })
    expect(getEsiOperationContract('bulk-affiliation')).toMatchObject({
      identity: {
        kind: 'set',
        maximumItems: getGeneratedEsiMaximumBatchSize('bulk-affiliation'),
      },
    })
    expect(getEsiOperationContract('wallet-balance')).toMatchObject({
      authorization: { kind: 'oauth', scope: 'esi-wallet.read_character_wallet.v1' },
      cache: runtimePrivateCache,
    })
    expect(getEsiOperationContract('wallet-transactions')).toMatchObject({
      identity: {
        fields: [
          { kind: 'scalar', field: 'characterId' },
          { kind: 'scalar', field: 'fromId', nullable: true },
        ],
        kind: 'mixed',
      },
      representationVersion: 'v3',
    })
  })

  test('fails closed for an unregistered operation name', () => {
    expect(() => assertRegisteredEsiOperation('new-unmetered-operation')).toThrow(
      'Unregistered ESI operation',
    )
  })

  test('merges the reviewed core and generated installed-module catalogs', () => {
    expect(esiMetadataReview).toStrictEqual({
      explorerUrl: 'https://developers.eveonline.com/api-explorer',
      requestedCompatibilityDate: '2026-08-23',
      resolvedCompatibilityDate: '2026-08-18',
      reviewedAt: '2026-09-03',
    })
    expect(
      Object.keys(coreEsiOperationCatalog).toSorted((left, right) => left.localeCompare(right)),
    ).toStrictEqual(
      Object.keys(esiOperationMetadata).toSorted((left, right) => left.localeCompare(right)),
    )
    expect(esiOperationCatalog).toStrictEqual({
      ...coreEsiOperationCatalog,
      ...installedModuleEsiOperationCatalog,
    })
  })

  test('resolves required authorization and rate-group metadata for every contract', () => {
    const resolved = []
    const expected = []
    for (const [operation, metadata] of Object.entries(esiOperationMetadata)) {
      const contract = getEsiOperationContract(operation as keyof typeof esiOperationCatalog)
      const generated = getGeneratedEsiOperationFacts(
        operation as keyof typeof esiOperationMetadata,
      )
      resolved.push({
        audit: contract.audit,
        authorization: contract.authorization,
        operation,
        rateGroup: contract.rateGroup,
        revalidate: contract.cache.kind === 'shared' ? contract.cache.revalidate : false,
        validRepresentationVersion: contract.representationVersion.length > 0,
      })
      expected.push({
        audit: {
          esiOperationId: metadata.esiOperationId,
          reviewedDate: esiMetadataReview.resolvedCompatibilityDate,
        },
        authorization:
          generated.authenticationScopes.length === 0
            ? {
                kind: 'public',
                subjectBindings: generated.requestSubjectBindings,
                requiredRolePredicate: null,
              }
            : {
                kind: 'oauth',
                scope: generated.authenticationScopes[0],
                subjectBindings: generated.requestSubjectBindings,
                requiredRolePredicate: contract.authorization.requiredRolePredicate,
              },
        operation,
        rateGroup: generated.rateLimit,
        revalidate: contract.cache.kind === 'shared' && generated.supportsConditionalRequests,
        validRepresentationVersion: true,
      })
    }
    expect(resolved).toStrictEqual(expected)
  })

  test('derives character scopes from every core and installed-module catalog contract', () => {
    const characterOperations = Object.entries(esiOperationCatalog).flatMap(
      ([operation, contract]) =>
        contract.authorization.kind === 'oauth'
          ? [[operation, contract.authorization.scope] as const]
          : [],
    )
    const publicOperations = Object.entries(esiOperationCatalog).flatMap(([operation, contract]) =>
      contract.authorization.kind === 'public' ? [operation] : [],
    )

    for (const [operation, scope] of characterOperations) {
      const registeredOperation = operation as keyof typeof esiOperationCatalog
      expect(getOptionalCharacterEsiScope(registeredOperation)).toBe(scope)
      expect(getCharacterEsiScope(registeredOperation)).toBe(scope)
    }
    for (const operation of publicOperations) {
      const registeredOperation = operation as keyof typeof esiOperationCatalog
      expect(getOptionalCharacterEsiScope(registeredOperation)).toBeNull()
      expect(() => getCharacterEsiScope(registeredOperation)).toThrow(
        `ESI operation ${operation} does not declare character authorization`,
      )
    }
  })

  test('derives protocol policy from generated SDK facts while retaining application exceptions', () => {
    const sdkOnlyBatchLimits: Array<[string, number]> = []
    const cacheFallbackDifferences: Array<[string, number, number]> = []
    const revalidationDerivations: Array<[boolean, boolean]> = []
    const identityBoundOperations = new Set([
      'bulk-affiliation',
      'character-asset-names',
      'character-cspa-charge',
      'mail-headers',
      'universe-resolve-ids',
      'universe-resolve-names',
    ])

    for (const [operation, metadata] of Object.entries(esiOperationMetadata)) {
      const contract = getEsiOperationContract(operation as keyof typeof esiOperationCatalog)
      const generated = getGeneratedEsiOperationFacts(
        operation as keyof typeof esiOperationMetadata,
      )

      expect(generated.classification).toBe(
        'mutation' in contract && contract.mutation ? 'mutation' : 'read',
      )
      expect(contract.rateGroup).toStrictEqual(generated.rateLimit)
      if (contract.cache.kind === 'shared') {
        revalidationDerivations.push([
          contract.cache.revalidate,
          generated.supportsConditionalRequests,
        ])
      }

      if (generated.maximumBatchSize !== null && !identityBoundOperations.has(operation)) {
        sdkOnlyBatchLimits.push([operation, generated.maximumBatchSize])
      }

      const generatedCacheAge =
        operationRegistry[metadata.esiOperationId].transport.protocol.cache.extensions[
          'x-cache-age'
        ]
      if (
        metadata.cache.kind === 'relative' &&
        generatedCacheAge !== undefined &&
        metadata.cache.seconds !== generatedCacheAge
      ) {
        cacheFallbackDifferences.push([operation, metadata.cache.seconds, generatedCacheAge])
      }
    }

    for (const operation of [
      'character-cspa-charge',
      'mail-create-label',
      'mail-delete',
      'mail-delete-label',
      'mail-send',
      'mail-update',
    ] as const) {
      expect(getGeneratedEsiOperationFacts(operation).supportsConditionalRequests).toBe(true)
      expect(getEsiOperationContract(operation).cache).toStrictEqual({ kind: 'none' })
    }
    expect(
      sdkOnlyBatchLimits.toSorted(([left], [right]) => left.localeCompare(right)),
    ).toStrictEqual([
      ['character-search', 11],
      ['mail-send', 50],
      ['mail-update', 25],
    ])
    expect(revalidationDerivations.every(([actual, generated]) => actual === generated)).toBe(true)
    expect(cacheFallbackDifferences).toStrictEqual([['skill-queue', 120, 60]])
  })

  test('fails closed when application mutation policy conflicts with SDK classification', () => {
    const cspa = getEsiOperationContract('character-cspa-charge')

    expect(() =>
      assertEsiOperationSdkClassifications({ 'character-cspa-charge': cspa }),
    ).not.toThrow()
    expect(() =>
      assertEsiOperationSdkClassifications(
        { 'character-cspa-charge': cspa },
        { PostCharactersCharacterIdCspa: { classification: 'mutation' } },
      ),
    ).toThrow('configured as read but SDK operation PostCharactersCharacterIdCspa is mutation')
  })

  test('records representative public and daily-boundary cache contracts', () => {
    expect(esiOperationMetadata['public-character']).toStrictEqual({
      cache: { kind: 'relative', seconds: 86_400 },
      esiOperationId: 'GetCharactersDetail',
      minimumCompatibilityDate: '2026-06-09',
    })
    expect(getGeneratedEsiOperationFacts('public-character')).toMatchObject({
      authenticationScopes: [],
      method: 'GET',
      path: '/characters/{character_id}',
      rateLimit: { kind: 'legacy-only' },
    })
    expect(esiOperationMetadata['universe-solar-system']).toStrictEqual({
      cache: { hour: 11, kind: 'daily-utc', minute: 5 },
      esiOperationId: 'GetUniverseSystemsSystemId',
      minimumCompatibilityDate: '2020-01-01',
    })
    expect(getGeneratedEsiOperationFacts('universe-solar-system')).toMatchObject({
      method: 'GET',
      path: '/universe/systems/{system_id}',
      rateLimit: { kind: 'legacy-only' },
    })
  })

  test('records representative character route-group contracts', () => {
    expect([esiOperationMetadata.location, esiOperationMetadata.ship]).toStrictEqual([
      expect.objectContaining({
        cache: { kind: 'relative', seconds: 5 },
      }),
      expect.objectContaining({
        cache: { kind: 'relative', seconds: 5 },
      }),
    ])
    for (const operation of ['location', 'ship'] as const) {
      expect(getGeneratedEsiOperationFacts(operation).rateLimit).toStrictEqual({
        group: 'char-location',
        kind: 'declared',
        maximumTokens: 1200,
        window: '15m',
      })
    }
    expect(esiOperationMetadata.skills).toMatchObject({
      cache: { kind: 'relative', seconds: 60 },
    })
    expect(esiOperationMetadata.attributes).toMatchObject({
      cache: { kind: 'relative', seconds: 120 },
      esiOperationId: 'GetCharactersCharacterIdAttributes',
    })
    expect(getGeneratedEsiOperationFacts('attributes')).toMatchObject({
      authenticationScopes: ['esi-skills.read_skills.v1'],
      method: 'GET',
      path: '/characters/{character_id}/attributes',
      rateLimit: {
        group: 'char-detail',
        kind: 'declared',
        maximumTokens: 600,
        window: '15m',
      },
      supportsConditionalRequests: true,
    })
    expect(getEsiOperationContract('attributes')).toMatchObject({
      authorization: { kind: 'oauth', scope: 'esi-skills.read_skills.v1' },
      cache: {
        ...runtimePrivateCache,
        revalidate: true,
      },
      identity: { fields: ['characterId'], kind: 'ordered' },
      retry: { kind: 'idempotent' },
    })
    expect(esiOperationMetadata['skill-queue']).toMatchObject({
      cache: { kind: 'relative', seconds: 120 },
      esiOperationId: 'GetCharactersCharacterIdSkillqueue',
    })
    expect(getGeneratedEsiOperationFacts('skill-queue')).toMatchObject({
      authenticationScopes: ['esi-skills.read_skillqueue.v1'],
      path: '/characters/{character_id}/skillqueue',
      supportsConditionalRequests: true,
    })
    expect(getEsiOperationContract('skill-queue')).toMatchObject({
      authorization: { kind: 'oauth', scope: 'esi-skills.read_skillqueue.v1' },
      cache: {
        ...runtimePrivateCache,
        revalidate: true,
      },
      identity: { fields: ['characterId'], kind: 'ordered' },
    })
    expect([
      esiOperationMetadata['wallet-balance'],
      esiOperationMetadata['wallet-journal'],
      esiOperationMetadata['wallet-transactions'],
    ]).toStrictEqual([
      expect.objectContaining({
        cache: { kind: 'relative', seconds: 120 },
      }),
      expect.objectContaining({
        cache: { kind: 'relative', seconds: 3600 },
      }),
      expect.objectContaining({
        cache: { kind: 'relative', seconds: 3600 },
      }),
    ])
    for (const operation of ['wallet-balance', 'wallet-journal', 'wallet-transactions'] as const) {
      expect(getGeneratedEsiOperationFacts(operation).rateLimit).toStrictEqual({
        group: 'char-wallet',
        kind: 'declared',
        maximumTokens: 150,
        window: '15m',
      })
    }
  })
})

describe('reviewed private ESI operation policy', () => {
  test('records reviewed Finance operation descriptors and private resilience contracts', () => {
    const expected = {
      'character-contract-bids': [
        'GetCharactersCharacterIdContractsContractIdBids',
        'esi-contracts.read_character_contracts.v1',
        { kind: 'declared', group: 'char-contract', maximumTokens: 600, window: '15m' },
      ],
      'character-contract-items': [
        'GetCharactersCharacterIdContractsContractIdItems',
        'esi-contracts.read_character_contracts.v1',
        { kind: 'declared', group: 'char-contract', maximumTokens: 600, window: '15m' },
      ],
      'character-contracts': [
        'GetCharactersCharacterIdContracts',
        'esi-contracts.read_character_contracts.v1',
        { kind: 'declared', group: 'char-contract', maximumTokens: 600, window: '15m' },
      ],
      'market-order-history': [
        'GetCharactersCharacterIdOrdersHistory',
        'esi-markets.read_character_orders.v1',
        { kind: 'legacy-only' },
      ],
      'market-orders': [
        'GetCharactersCharacterIdOrders',
        'esi-markets.read_character_orders.v1',
        { kind: 'legacy-only' },
      ],
      'wallet-journal': [
        'GetCharactersCharacterIdWalletJournal',
        'esi-wallet.read_character_wallet.v1',
        { kind: 'declared', group: 'char-wallet', maximumTokens: 150, window: '15m' },
      ],
    } as const

    for (const [operation, [esiOperationId, scope, rateGroup]] of Object.entries(expected)) {
      const metadata = esiOperationMetadata[operation as keyof typeof expected]
      const contract = getEsiOperationContract(operation as keyof typeof expected)
      const generated = getGeneratedEsiOperationFacts(operation as keyof typeof expected)
      expect(metadata).toMatchObject({
        esiOperationId,
        minimumCompatibilityDate: '2020-01-01',
      })
      expect(generated).toMatchObject({
        authenticationScopes: [scope],
        method: 'GET',
        rateLimit: rateGroup,
        supportsConditionalRequests: true,
      })
      expect(contract).toMatchObject({
        authorization: { kind: 'oauth', scope },
        cache: {
          ...runtimePrivateCache,
          revalidate: true,
        },
        rateGroup,
        retry: { kind: 'idempotent' },
      })
    }
  })

  test('records reviewed clone operation descriptors and private resilience contracts', () => {
    const expected = {
      'character-clones': [
        '/characters/{character_id}/clones',
        'GetCharactersCharacterIdClones',
        'esi-clones.read_clones.v1',
        { group: 'char-location', kind: 'declared', maximumTokens: 1200, window: '15m' },
      ],
      'character-implants': [
        '/characters/{character_id}/implants',
        'GetCharactersCharacterIdImplants',
        'esi-clones.read_implants.v1',
        { group: 'char-detail', kind: 'declared', maximumTokens: 600, window: '15m' },
      ],
    } as const

    for (const [operation, [path, esiOperationId, scope, rateGroup]] of Object.entries(expected)) {
      const metadata = esiOperationMetadata[operation as keyof typeof expected]
      const contract = getEsiOperationContract(operation as keyof typeof expected)
      const generated = getGeneratedEsiOperationFacts(operation as keyof typeof expected)
      expect(metadata).toMatchObject({
        cache: { kind: 'relative', seconds: 120 },
        esiOperationId,
        minimumCompatibilityDate: '2020-01-01',
      })
      expect(generated).toMatchObject({
        authenticationScopes: [scope],
        method: 'GET',
        path,
        rateLimit: rateGroup,
        supportsConditionalRequests: true,
      })
      expect(contract).toMatchObject({
        authorization: { kind: 'oauth', scope },
        cache: {
          ...runtimePrivateCache,
          revalidate: true,
        },
        freshness: { kind: 'relative', seconds: 120 },
        identity: { fields: ['characterId'], kind: 'ordered' },
        rateGroup,
        retry: { kind: 'idempotent' },
      })
    }
  })

  test('records only the reviewed character asset operations and their shared private policy', () => {
    const expected = {
      'character-asset-names': {
        cache: { kind: 'runtime-only' },
        esiOperationId: 'PostCharactersCharacterIdAssetsNames',
        identity: {
          fields: [
            { kind: 'scalar', field: 'characterId' },
            { kind: 'set', field: 'itemIds', maximumItems: 1000 },
          ],
          kind: 'mixed',
        },
        method: 'POST',
        path: '/characters/{character_id}/assets/names',
      },
      'character-assets-page': {
        cache: { kind: 'relative', seconds: 3600 },
        esiOperationId: 'GetCharactersCharacterIdAssets',
        identity: { fields: ['characterId', 'page'], kind: 'ordered' },
        method: 'GET',
        path: '/characters/{character_id}/assets',
      },
    } as const

    for (const [operation, asset] of Object.entries(expected)) {
      const metadata = esiOperationMetadata[operation as keyof typeof expected]
      const contract = getEsiOperationContract(operation as keyof typeof expected)
      const generated = getGeneratedEsiOperationFacts(operation as keyof typeof expected)
      expect(metadata).toMatchObject({
        cache: asset.cache,
        esiOperationId: asset.esiOperationId,
        minimumCompatibilityDate: '2020-01-01',
      })
      expect(generated).toMatchObject({
        authenticationScopes: ['esi-assets.read_assets.v1'],
        method: asset.method,
        path: asset.path,
        rateLimit: {
          group: 'char-asset',
          kind: 'declared',
          maximumTokens: 1800,
          window: '15m',
        },
        supportsConditionalRequests: true,
      })
      expect(contract).toMatchObject({
        authorization: { kind: 'oauth', scope: 'esi-assets.read_assets.v1' },
        cache: {
          ...runtimePrivateCache,
          revalidate: true,
        },
        freshness: asset.cache,
        identity: asset.identity,
        rateGroup: {
          group: 'char-asset',
          kind: 'declared',
          maximumTokens: 1800,
          window: '15m',
        },
        retry: { kind: 'idempotent' },
      })
    }

    expect(
      Object.values(esiOperationMetadata).map(({ esiOperationId }) => esiOperationId),
    ).not.toStrictEqual(
      expect.arrayContaining([
        'PostCharactersCharacterIdAssetsLocations',
        'GetUniverseStructuresStructureId',
        'GetCorporationsCorporationIdAssets',
      ]),
    )
  })

  test('records composition lookup and charge policies', () => {
    expect(esiOperationMetadata['universe-resolve-ids']).toMatchObject({
      cache: { kind: 'runtime-only' },
      esiOperationId: 'PostUniverseIds',
    })
    expect(getGeneratedEsiOperationFacts('universe-resolve-ids')).toMatchObject({
      authenticationScopes: [],
      maximumBatchSize: 500,
      method: 'POST',
      path: '/universe/ids',
      rateLimit: { kind: 'legacy-only' },
      supportsConditionalRequests: true,
    })
    expect(getEsiOperationContract('universe-resolve-ids')).toMatchObject({
      authorization: { kind: 'public' },
      cache: { kind: 'shared', revalidate: true },
      freshness: { kind: 'relative', seconds: 3600 },
      identity: { field: 'names', kind: 'set', maximumItems: 500 },
      retry: { kind: 'idempotent' },
    })

    expect(esiOperationMetadata['character-search']).toMatchObject({
      cache: { kind: 'relative', seconds: 3600 },
      esiOperationId: 'GetCharactersCharacterIdSearch',
    })
    expect(getGeneratedEsiOperationFacts('character-search')).toMatchObject({
      authenticationScopes: ['esi-search.search_structures.v1'],
      method: 'GET',
      path: '/characters/{character_id}/search',
      rateLimit: { kind: 'legacy-only' },
      supportsConditionalRequests: true,
    })
    expect(getEsiOperationContract('character-search')).toMatchObject({
      authorization: { kind: 'oauth', scope: 'esi-search.search_structures.v1' },
      cache: {
        ...runtimePrivateCache,
        revalidate: true,
      },
      identity: { fields: ['characterId', 'search'], kind: 'ordered' },
      retry: { kind: 'idempotent' },
    })

    expect(esiOperationMetadata['character-cspa-charge']).toMatchObject({
      cache: { kind: 'none' },
      esiOperationId: 'PostCharactersCharacterIdCspa',
    })
    expect(getGeneratedEsiOperationFacts('character-cspa-charge')).toMatchObject({
      authenticationScopes: ['esi-characters.read_contacts.v1'],
      classification: 'read',
      maximumBatchSize: 100,
      method: 'POST',
      path: '/characters/{character_id}/cspa',
      rateLimit: {
        group: 'char-detail',
        kind: 'declared',
        maximumTokens: 600,
        window: '15m',
      },
      supportsConditionalRequests: true,
    })
    const cspa = getEsiOperationContract('character-cspa-charge')
    expect(cspa).toMatchObject({
      authorization: { kind: 'oauth', scope: 'esi-characters.read_contacts.v1' },
      cache: { kind: 'none' },
      rateGroup: {
        group: 'char-detail',
        kind: 'declared',
        maximumTokens: 600,
        window: '15m',
      },
      retry: { kind: 'idempotent' },
    })
    expect(cspa.resourceRevision).toBeUndefined()
  })

  test('records all reviewed mail methods, scopes, cache behavior, and retry policies', () => {
    const mailPolicies = [
      ['mail-headers', 'GET', 'esi-mail.read_mail.v1', true, 'idempotent'],
      ['mail-message', 'GET', 'esi-mail.read_mail.v1', true, 'idempotent'],
      ['mail-labels', 'GET', 'esi-mail.read_mail.v1', true, 'idempotent'],
      ['mail-lists', 'GET', 'esi-mail.read_mail.v1', true, 'idempotent'],
      ['mail-send', 'POST', 'esi-mail.send_mail.v1', false, 'none'],
      ['mail-create-label', 'POST', 'esi-mail.organize_mail.v1', false, 'none'],
      ['mail-update', 'PUT', 'esi-mail.organize_mail.v1', false, 'idempotent'],
      ['mail-delete', 'DELETE', 'esi-mail.organize_mail.v1', false, 'idempotent'],
      ['mail-delete-label', 'DELETE', 'esi-mail.organize_mail.v1', false, 'idempotent'],
    ] as const

    for (const [operation, method, scope, revalidate, retryKind] of mailPolicies) {
      const metadata = esiOperationMetadata[operation]
      const contract = getEsiOperationContract(operation)
      const generated = getGeneratedEsiOperationFacts(operation)
      expect(metadata).toMatchObject({
        minimumCompatibilityDate: '2020-01-01',
      })
      expect(generated).toMatchObject({
        authenticationScopes: [scope],
        method,
        rateLimit: {
          group: 'char-social',
          kind: 'declared',
          maximumTokens: 600,
          window: '15m',
        },
        supportsConditionalRequests: true,
      })
      expect(contract).toMatchObject({
        audit: { reviewedDate: '2026-08-18' },
        authorization: { kind: 'oauth', scope },
        rateGroup: {
          group: 'char-social',
          kind: 'declared',
          maximumTokens: 600,
          window: '15m',
        },
        retry: { kind: retryKind },
      })
      expect(contract.cache.kind === 'shared' ? contract.cache.revalidate : false).toBe(revalidate)
    }

    expect(getGeneratedEsiMaximumBatchSize('mail-headers')).toBe(25)
    const mailHeaderIdentity = getEsiOperationContract('mail-headers').identity
    const mailHeaderIdentityFields =
      mailHeaderIdentity.kind === 'mixed' ? mailHeaderIdentity.fields : []
    expect(mailHeaderIdentity).toMatchObject({ kind: 'mixed' })
    expect(mailHeaderIdentityFields).toContainEqual(
      expect.objectContaining({ field: 'labels', kind: 'set', maximumItems: 25 }),
    )

    expect(getEsiOperationContract('mail-message')).toMatchObject({
      cache: { kind: 'shared', retentionMilliseconds: 0, stale: { kind: 'none' } },
      freshness: { kind: 'relative', seconds: 30 },
    })
    expect(getEsiOperationContract('mail-lists')).toMatchObject({
      freshness: { kind: 'relative', seconds: 120 },
    })
    for (const operation of [
      'mail-send',
      'mail-create-label',
      'mail-update',
      'mail-delete',
      'mail-delete-label',
    ] as const) {
      expect(getEsiOperationContract(operation).cache).toStrictEqual({ kind: 'none' })
    }
  })

  test('rejects incompatible dates and missing requestable private scopes at startup', () => {
    expect(() =>
      assertEsiCatalogConfiguration({
        compatibilityDate: '2026-06-08',
        requestableScopes: [],
        ssoEnabled: false,
      }),
    ).toThrow('public-character requires 2026-06-09')
    expect(() =>
      assertEsiCatalogConfiguration({
        compatibilityDate: '2026-08-23',
        requestableScopes: ['esi-location.read_location.v1'],
        ssoEnabled: true,
      }),
    ).toThrow(
      'EVE_SCOPES is missing scopes required by registered ESI operations: esi-assets.read_assets.v1 esi-characters.read_contacts.v1 esi-characters.read_corporation_roles.v1 esi-characters.read_freelance_jobs.v1 esi-clones.read_clones.v1 esi-clones.read_implants.v1 esi-contracts.read_character_contracts.v1 esi-corporations.read_corporation_membership.v1 esi-corporations.read_freelance_jobs.v1 esi-corporations.read_projects.v1 esi-location.read_ship_type.v1 esi-mail.organize_mail.v1 esi-mail.read_mail.v1 esi-mail.send_mail.v1 esi-markets.read_character_orders.v1 esi-search.search_structures.v1 esi-skills.read_skillqueue.v1 esi-skills.read_skills.v1 esi-wallet.read_character_wallet.v1 esi.activity.char:read',
    )
  })

  test('accepts the reviewed date and configured private scopes without requiring SSO when disabled', () => {
    expect(() =>
      assertEsiCatalogConfiguration({
        compatibilityDate: '2026-08-23',
        requestableScopes: [
          'esi-assets.read_assets.v1',
          'esi-characters.read_contacts.v1',
          'esi-characters.read_corporation_roles.v1',
          'esi-clones.read_clones.v1',
          'esi-clones.read_implants.v1',
          'esi-contracts.read_character_contracts.v1',
          'esi-corporations.read_corporation_membership.v1',
          'esi-location.read_location.v1',
          'esi-location.read_ship_type.v1',
          'esi-mail.organize_mail.v1',
          'esi-mail.read_mail.v1',
          'esi-mail.send_mail.v1',
          'esi-markets.read_character_orders.v1',
          'esi-search.search_structures.v1',
          'esi-skills.read_skillqueue.v1',
          'esi-skills.read_skills.v1',
          'esi-wallet.read_character_wallet.v1',
          'esi-characters.read_freelance_jobs.v1',
          'esi-corporations.read_freelance_jobs.v1',
          'esi-corporations.read_projects.v1',
          'esi.activity.char:read',
        ],
        ssoEnabled: true,
      }),
    ).not.toThrow()
    expect(() =>
      assertEsiCatalogConfiguration({
        compatibilityDate: '2026-08-23',
        requestableScopes: [],
        ssoEnabled: false,
      }),
    ).not.toThrow()
  })
})

test.each([
  'esi-assets.read_assets.v1',
  'esi-characters.read_corporation_roles.v1',
  'esi-clones.read_clones.v1',
  'esi-clones.read_implants.v1',
  'esi-markets.read_character_orders.v1',
  'esi-contracts.read_character_contracts.v1',
  'esi-corporations.read_corporation_membership.v1',
])('rejects configured SSO when %s is missing', (missingScope) => {
  const requestableScopes = [
    'esi-assets.read_assets.v1',
    'esi-characters.read_contacts.v1',
    'esi-characters.read_corporation_roles.v1',
    'esi-clones.read_clones.v1',
    'esi-clones.read_implants.v1',
    'esi-contracts.read_character_contracts.v1',
    'esi-corporations.read_corporation_membership.v1',
    'esi-location.read_location.v1',
    'esi-location.read_ship_type.v1',
    'esi-mail.organize_mail.v1',
    'esi-mail.read_mail.v1',
    'esi-mail.send_mail.v1',
    'esi-markets.read_character_orders.v1',
    'esi-search.search_structures.v1',
    'esi-skills.read_skillqueue.v1',
    'esi-skills.read_skills.v1',
    'esi-wallet.read_character_wallet.v1',
    'esi-characters.read_freelance_jobs.v1',
    'esi-corporations.read_freelance_jobs.v1',
    'esi-corporations.read_projects.v1',
    'esi.activity.char:read',
  ].filter((scope) => scope !== missingScope)

  expect(() =>
    assertEsiCatalogConfiguration({
      compatibilityDate: '2026-08-23',
      requestableScopes,
      ssoEnabled: true,
    }),
  ).toThrow(`EVE_SCOPES is missing scopes required by registered ESI operations: ${missingScope}`)
})

test.each([
  [
    'compatibility date',
    () => ({ ...validModuleOperation(), compatibility: { minimumDate: '2026-02-30' } }),
    'invalid minimum compatibility date',
  ],
  [
    'review date',
    () => ({
      ...validModuleOperation(),
      audit: { ...validModuleOperation().audit, reviewedDate: 'soon' },
    }),
    'invalid review date',
  ],
  [
    'authorization strategy',
    () => ({ ...validModuleOperation(), authorization: { kind: 'module-token' } }),
    'unsupported authorization strategy',
  ],
  [
    'character scope',
    () => ({ ...validModuleOperation(), authorization: { kind: 'oauth', scope: 'wallet' } }),
    'invalid character scope',
  ],
  [
    'unknown request subject',
    () => ({
      ...validModuleOperation(),
      authorization: {
        kind: 'public',
        subjectBindings: ['account_id'],
        requiredRolePredicate: null,
      },
    }),
    'authorization',
  ],
  [
    'duplicate request subject',
    () => ({
      ...validModuleOperation(),
      authorization: {
        kind: 'public',
        subjectBindings: ['character_id', 'character_id'],
        requiredRolePredicate: null,
      },
    }),
    'request subject bindings must be unique and canonical',
  ],
  [
    'unreviewed operation role',
    () => ({
      ...validModuleOperation(),
      authorization: {
        kind: 'oauth',
        scope: 'esi-wallet.read_character_wallet.v1',
        subjectBindings: ['character_id'],
        requiredRolePredicate: 'junior-accountant',
      },
    }),
    'authorization',
  ],
  [
    'public operation role',
    () => ({
      ...validModuleOperation(),
      authorization: { kind: 'public', subjectBindings: [], requiredRolePredicate: 'accountant' },
    }),
    'authorization',
  ],
  [
    'ordered identity',
    () => ({ ...validModuleOperation(), identity: { fields: ['id', 'id'], kind: 'ordered' } }),
    'invalid or duplicate ordered identity fields',
  ],
  [
    'set identity',
    () => ({
      ...validModuleOperation(),
      identity: { field: 'ids', kind: 'set', maximumItems: 0 },
    }),
    'set identity maximum must be a positive safe integer',
  ],
  [
    'freshness',
    () => ({ ...validModuleOperation(), freshness: { kind: 'relative', seconds: 0 } }),
    'relative freshness must use positive whole seconds',
  ],
  [
    'mutation',
    () => ({ ...validModuleOperation(), mutation: { kind: 'character' } }),
    'invalid mutation metadata',
  ],
  [
    'cache behavior',
    () => ({
      ...validModuleOperation(),
      cache: {
        ...validModuleOperation().cache,
        retentionMilliseconds: 60_000,
        stale: { kind: 'bounded', milliseconds: 120_000 },
      },
    }),
    'stale duration exceeds cache retention',
  ],
  [
    'rate group',
    () => ({
      ...validModuleOperation(),
      rateGroup: { group: 'Module Group', kind: 'declared', maximumTokens: 100, window: '15m' },
    }),
    'invalid declared rate-group metadata',
  ],
  [
    'retry policy',
    () => ({
      ...validModuleOperation(),
      retry: {
        attempts: 3,
        initialDelayMilliseconds: 2000,
        kind: 'idempotent',
        maximumDelayMilliseconds: 1000,
      },
    }),
    'invalid idempotent retry metadata',
  ],
  [
    'retry attempt budget',
    () => ({
      ...validModuleOperation(),
      retry: {
        attempts: 4,
        initialDelayMilliseconds: 500,
        kind: 'idempotent',
        maximumDelayMilliseconds: 10_000,
      },
    }),
    'invalid idempotent retry metadata',
  ],
  [
    'response validation',
    () => ({
      ...validModuleOperation(),
      responseValidation: { kind: 'disabled', reason: '  ' },
    }),
    'invalid response-validation exception',
  ],
])('rejects invalid contributed %s metadata before startup', (_field, createContract, message) => {
  expect(() => assertEsiOperationContracts({ 'module-operation': createContract() })).toThrow(
    message,
  )
})

describe('contributed ESI catalog validation', () => {
  test('rejects conflicting contributed rate-group definitions', () => {
    const first = validModuleOperation()
    const second = {
      ...validModuleOperation(),
      rateGroup: { ...validModuleOperation().rateGroup, maximumTokens: 200 },
    }

    expect(() =>
      assertEsiOperationContracts({ 'first-operation': first, 'second-operation': second }),
    ).toThrow('rate group module-group conflicts with operation first-operation')
  })

  test('rejects contributed SDK operation identity mismatches and duplicates', () => {
    expect(() =>
      assertEsiOperationContracts(
        { 'module-operation': validModuleOperation() },
        { 'module-operation': 'GetExpectedModuleOperation' },
      ),
    ).toThrow('instead of manifest SDK operation GetExpectedModuleOperation')
    expect(() =>
      assertEsiOperationContracts({
        'first-operation': validModuleOperation(),
        'second-operation': validModuleOperation(),
      }),
    ).toThrow('duplicates ESI SDK operation GetModuleOperation from operation first-operation')
  })

  test('validates contributed contracts even when SSO runtime eligibility is disabled', () => {
    expect(() =>
      assertEsiOperationCatalogConfiguration(
        {
          compatibilityDate: '2026-08-23',
          requestableScopes: [],
          ssoEnabled: false,
        },
        {
          'module-operation': {
            ...validModuleOperation(),
            responseValidation: { kind: 'disabled', reason: '' },
          },
        },
      ),
    ).toThrow('invalid response-validation exception')
    expect(() =>
      assertEsiOperationCatalogConfiguration(
        {
          compatibilityDate: '2026-8-23',
          requestableScopes: [],
          ssoEnabled: false,
        },
        { 'module-operation': validModuleOperation() },
      ),
    ).toThrow('compatibility configuration date must use YYYY-MM-DD')
  })
})

function validModuleOperation() {
  return {
    audit: { esiOperationId: 'GetModuleOperation', reviewedDate: '2026-08-18' },
    authorization: { kind: 'public', subjectBindings: [], requiredRolePredicate: null },
    cache: {
      collapse: true,
      kind: 'shared',
      retentionMilliseconds: 60_000,
      revalidate: true,
      stale: { kind: 'bounded', milliseconds: 30_000 },
    },
    compatibility: { minimumDate: '2026-01-01' },
    freshness: { kind: 'relative', seconds: 60 },
    identity: { fields: ['subjectId'], kind: 'ordered' },
    rateGroup: {
      group: 'module-group',
      kind: 'declared',
      maximumTokens: 100,
      window: '15m',
    },
    representationVersion: 'v1',
    responseValidation: { kind: 'enabled' },
    retry: {
      attempts: 3,
      initialDelayMilliseconds: 100,
      kind: 'idempotent',
      maximumDelayMilliseconds: 1000,
    },
  } as const
}

describe('ESI mutation contracts', () => {
  test('declares every character mutation and its 404 semantics in the catalog', () => {
    const mutations = Object.entries(esiOperationCatalog)
      .filter(([, contract]) => 'mutation' in contract && contract.mutation)
      .map(([operation, contract]) => [
        operation,
        'mutation' in contract ? contract.mutation?.appliedOnMissing : undefined,
      ])

    expect(mutations).toStrictEqual([
      ['mail-send', false],
      ['mail-create-label', false],
      ['mail-update', false],
      ['mail-delete', true],
      ['mail-delete-label', true],
    ])
  })

  test('requires a mutation to be character-authorized and uncached', () => {
    expect(() =>
      assertEsiOperationContracts({
        'module-operation': {
          ...validModuleOperation(),
          cache: { kind: 'none' },
          mutation: { appliedOnMissing: false, kind: 'character' },
        },
      }),
    ).toThrow('declares a mutation without character authorization and an uncached contract')
  })

  test('keeps every mutation out of the cached read paths', () => {
    for (const [, contract] of Object.entries(esiOperationCatalog)) {
      if (!('mutation' in contract) || !contract.mutation) {
        continue
      }
      expect(contract.cache.kind).toBe('none')
      expect(contract.authorization.kind).toBe('oauth')
    }
  })
})

describe('ESI response classification', () => {
  test('charges the documented bucket cost for each response class', () => {
    expect(classifyEsiResponse(200)).toStrictEqual({ outcome: 'success', tokenCost: 2 })
    expect(classifyEsiResponse(204)).toStrictEqual({ outcome: 'success', tokenCost: 2 })
    expect(classifyEsiResponse(301)).toStrictEqual({ outcome: 'redirect', tokenCost: 1 })
    expect(classifyEsiResponse(304)).toStrictEqual({ outcome: 'notModified', tokenCost: 1 })
    expect(classifyEsiResponse(307)).toStrictEqual({ outcome: 'redirect', tokenCost: 1 })
    expect(classifyEsiResponse(404)).toStrictEqual({ outcome: 'clientError', tokenCost: 5 })
    expect(classifyEsiResponse(500)).toStrictEqual({ outcome: 'serverError', tokenCost: 0 })
  })

  test('exempts 429 from the client-error cost so cooldowns are not self-reinforcing', () => {
    expect(classifyEsiResponse(429)).toStrictEqual({ outcome: 'rateLimited', tokenCost: 0 })
  })
})
