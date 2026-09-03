import { describe, expect, test } from 'vitest'
import { operationRegistry } from '@evespace/esi-client/operations'
import {
  esiMetadataReview,
  esiOperationMetadata,
} from '../../src/esi-resilience/operation-metadata.js'
import {
  assertExecutableEsiOperationDefinitions,
  assertEsiOperationCatalogConfiguration,
  assertRegisteredEsiOperation,
  coreEsiOperationCatalog,
  esiOperationCatalog,
  getEsiOperationContract,
} from '../../src/esi-resilience/catalog.js'
import { assertEsiOperationContracts } from '../../src/esi-resilience/catalog-validation.js'
import { installedModuleEsiOperationCatalog } from '../../src/generated/platform/installed-module-esi.js'

describe('ESI operation policies', () => {
  test('requires definitions to own a real matching SDK descriptor and catalog contract', () => {
    const contract = {
      ...validModuleOperation(),
      audit: { esiOperationId: 'GetStatus', reviewedDate: '2026-08-18' },
    } as const
    const definition = {
      sdkOperationId: 'GetStatus' as const,
      descriptor: operationRegistry.GetStatus!,
      contract,
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
  })

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
      representationVersion: 'v2',
    })
    expect(getEsiOperationContract('skills')).toMatchObject({
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
      cache: { kind: 'shared', stale: { kind: 'outage', milliseconds: 3_600_000 } },
    })
    expect(getEsiOperationContract('wallet-transactions')).toMatchObject({
      representationVersion: 'v3',
      identity: {
        kind: 'mixed',
        fields: [
          { kind: 'scalar', field: 'characterId' },
          { kind: 'scalar', field: 'fromId', nullable: true },
        ],
      },
    })
  })

  test('fails closed for an unregistered operation name', () => {
    expect(() => assertRegisteredEsiOperation('new-unmetered-operation')).toThrow(
      'Unregistered ESI operation',
    )
  })

  test('merges the reviewed core and generated installed-module catalogs', () => {
    expect(esiMetadataReview).toEqual({
      explorerUrl: 'https://developers.eveonline.com/api-explorer',
      reviewedAt: '2026-09-03',
      requestedCompatibilityDate: '2026-08-23',
      resolvedCompatibilityDate: '2026-08-18',
    })
    expect(
      Object.keys(coreEsiOperationCatalog).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(
      Object.keys(esiOperationMetadata).toSorted((left, right) => left.localeCompare(right)),
    )
    expect(esiOperationCatalog).toEqual({
      ...coreEsiOperationCatalog,
      ...installedModuleEsiOperationCatalog,
    })
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
            ? {
                kind: 'declared',
                group: metadata.rateLimit.group,
                maximumTokens: metadata.rateLimit.maximumTokens,
                window: metadata.rateLimit.window,
              }
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
    expect(esiOperationMetadata.attributes).toMatchObject({
      method: 'GET',
      path: '/characters/{character_id}/attributes',
      esiOperationId: 'GetCharactersCharacterIdAttributes',
      requiredScope: 'esi-skills.read_skills.v1',
      cache: { kind: 'relative', seconds: 120 },
      supportsConditionalRequests: true,
      rateLimit: {
        kind: 'declared',
        group: 'char-detail',
        maximumTokens: 600,
        window: '15m',
      },
    })
    expect(getEsiOperationContract('attributes')).toMatchObject({
      authorization: { kind: 'character', scope: 'esi-skills.read_skills.v1' },
      identity: { kind: 'ordered', fields: ['characterId'] },
      cache: {
        kind: 'shared',
        revalidate: true,
        stale: { kind: 'outage', milliseconds: 3_600_000 },
      },
      retry: { kind: 'idempotent' },
    })
    expect(esiOperationMetadata['skill-queue']).toMatchObject({
      path: '/characters/{character_id}/skillqueue',
      esiOperationId: 'GetCharactersCharacterIdSkillqueue',
      requiredScope: 'esi-skills.read_skillqueue.v1',
      cache: { kind: 'relative', seconds: 120 },
      supportsConditionalRequests: true,
    })
    expect(getEsiOperationContract('skill-queue')).toMatchObject({
      authorization: { kind: 'character', scope: 'esi-skills.read_skillqueue.v1' },
      identity: { kind: 'ordered', fields: ['characterId'] },
      cache: {
        kind: 'shared',
        revalidate: true,
        stale: { kind: 'outage', milliseconds: 3_600_000 },
      },
    })
    expect([
      esiOperationMetadata['wallet-balance'],
      esiOperationMetadata['wallet-journal'],
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

  test('records reviewed Finance operation descriptors and private resilience contracts', () => {
    const expected = {
      'wallet-journal': [
        'GetCharactersCharacterIdWalletJournal',
        'esi-wallet.read_character_wallet.v1',
        { kind: 'declared', group: 'char-wallet', maximumTokens: 150, window: '15m' },
      ],
      'market-orders': [
        'GetCharactersCharacterIdOrders',
        'esi-markets.read_character_orders.v1',
        { kind: 'legacy-only' },
      ],
      'market-order-history': [
        'GetCharactersCharacterIdOrdersHistory',
        'esi-markets.read_character_orders.v1',
        { kind: 'legacy-only' },
      ],
      'character-contracts': [
        'GetCharactersCharacterIdContracts',
        'esi-contracts.read_character_contracts.v1',
        { kind: 'declared', group: 'char-contract', maximumTokens: 600, window: '15m' },
      ],
      'character-contract-items': [
        'GetCharactersCharacterIdContractsContractIdItems',
        'esi-contracts.read_character_contracts.v1',
        { kind: 'declared', group: 'char-contract', maximumTokens: 600, window: '15m' },
      ],
      'character-contract-bids': [
        'GetCharactersCharacterIdContractsContractIdBids',
        'esi-contracts.read_character_contracts.v1',
        { kind: 'declared', group: 'char-contract', maximumTokens: 600, window: '15m' },
      ],
    } as const

    for (const [operation, [esiOperationId, scope, rateGroup]] of Object.entries(expected)) {
      const metadata = esiOperationMetadata[operation as keyof typeof expected]
      const contract = getEsiOperationContract(operation as keyof typeof expected)
      expect(operationRegistry[esiOperationId]).toBeDefined()
      expect(metadata).toMatchObject({
        method: 'GET',
        esiOperationId,
        minimumCompatibilityDate: '2020-01-01',
        requiredScope: scope,
        supportsConditionalRequests: true,
        rateLimit: rateGroup,
      })
      expect(contract).toMatchObject({
        authorization: { kind: 'character', scope },
        cache: {
          kind: 'shared',
          collapse: true,
          revalidate: true,
          stale: { kind: 'outage', milliseconds: 3_600_000 },
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
        { kind: 'declared', group: 'char-location', maximumTokens: 1_200, window: '15m' },
      ],
      'character-implants': [
        '/characters/{character_id}/implants',
        'GetCharactersCharacterIdImplants',
        'esi-clones.read_implants.v1',
        { kind: 'declared', group: 'char-detail', maximumTokens: 600, window: '15m' },
      ],
    } as const

    for (const [operation, [path, esiOperationId, scope, rateGroup]] of Object.entries(expected)) {
      const metadata = esiOperationMetadata[operation as keyof typeof expected]
      const contract = getEsiOperationContract(operation as keyof typeof expected)
      expect(operationRegistry[esiOperationId]).toBeDefined()
      expect(metadata).toMatchObject({
        method: 'GET',
        path,
        esiOperationId,
        minimumCompatibilityDate: '2020-01-01',
        requiredScope: scope,
        cache: { kind: 'relative', seconds: 120 },
        supportsConditionalRequests: true,
        rateLimit: rateGroup,
      })
      expect(contract).toMatchObject({
        authorization: { kind: 'character', scope },
        identity: { kind: 'ordered', fields: ['characterId'] },
        freshness: { kind: 'relative', seconds: 120 },
        cache: {
          kind: 'shared',
          collapse: true,
          revalidate: true,
          stale: { kind: 'outage', milliseconds: 3_600_000 },
          retentionMilliseconds: 3_600_000,
        },
        rateGroup,
        retry: { kind: 'idempotent' },
      })
    }
  })

  test('records composition lookup and charge policies', () => {
    expect(esiOperationMetadata['universe-resolve-ids']).toMatchObject({
      method: 'POST',
      path: '/universe/ids',
      esiOperationId: 'PostUniverseIds',
      requiredScope: null,
      cache: { kind: 'runtime-only' },
      supportsConditionalRequests: true,
      rateLimit: { kind: 'legacy-only' },
      maximumBatchSize: 500,
    })
    expect(getEsiOperationContract('universe-resolve-ids')).toMatchObject({
      authorization: { kind: 'public' },
      identity: { kind: 'set', field: 'names', maximumItems: 500 },
      freshness: { kind: 'relative', seconds: 3_600 },
      cache: { kind: 'shared', revalidate: true },
      retry: { kind: 'idempotent' },
    })

    expect(esiOperationMetadata['character-search']).toMatchObject({
      method: 'GET',
      path: '/characters/{character_id}/search',
      esiOperationId: 'GetCharactersCharacterIdSearch',
      requiredScope: 'esi-search.search_structures.v1',
      cache: { kind: 'relative', seconds: 3_600 },
      supportsConditionalRequests: true,
      rateLimit: { kind: 'legacy-only' },
    })
    expect(getEsiOperationContract('character-search')).toMatchObject({
      authorization: { kind: 'character', scope: 'esi-search.search_structures.v1' },
      identity: { kind: 'ordered', fields: ['characterId', 'search'] },
      cache: {
        kind: 'shared',
        revalidate: true,
        stale: { kind: 'outage', milliseconds: 3_600_000 },
      },
      retry: { kind: 'idempotent' },
    })

    expect(esiOperationMetadata['character-cspa-charge']).toMatchObject({
      method: 'POST',
      path: '/characters/{character_id}/cspa',
      esiOperationId: 'PostCharactersCharacterIdCspa',
      requiredScope: 'esi-characters.read_contacts.v1',
      cache: { kind: 'none' },
      supportsConditionalRequests: false,
      rateLimit: {
        kind: 'declared',
        group: 'char-detail',
        maximumTokens: 600,
        window: '15m',
      },
      maximumBatchSize: 100,
    })
    const cspa = getEsiOperationContract('character-cspa-charge')
    expect(cspa).toMatchObject({
      authorization: { kind: 'character', scope: 'esi-characters.read_contacts.v1' },
      cache: { kind: 'none' },
      rateGroup: {
        kind: 'declared',
        group: 'char-detail',
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
      expect(metadata).toMatchObject({
        method,
        minimumCompatibilityDate: '2020-01-01',
        requiredScope: scope,
        supportsConditionalRequests: revalidate,
        rateLimit: {
          kind: 'declared',
          group: 'char-social',
          maximumTokens: 600,
          window: '15m',
        },
      })
      expect(contract).toMatchObject({
        audit: { reviewedDate: '2026-08-18' },
        authorization: { kind: 'character', scope },
        rateGroup: {
          kind: 'declared',
          group: 'char-social',
          maximumTokens: 600,
          window: '15m',
        },
        retry: { kind: retryKind },
      })
      expect(contract.cache.kind === 'shared' ? contract.cache.revalidate : false).toBe(revalidate)
    }

    expect(esiOperationMetadata['mail-headers'].maximumBatchSize).toBe(25)
    const mailHeaderIdentity = getEsiOperationContract('mail-headers').identity
    const mailHeaderIdentityFields =
      mailHeaderIdentity.kind === 'mixed' ? mailHeaderIdentity.fields : []
    expect(mailHeaderIdentity).toMatchObject({ kind: 'mixed' })
    expect(mailHeaderIdentityFields).toContainEqual(
      expect.objectContaining({ kind: 'set', field: 'labels', maximumItems: 25 }),
    )

    expect(getEsiOperationContract('mail-message')).toMatchObject({
      freshness: { kind: 'relative', seconds: 30 },
      cache: { kind: 'shared', retentionMilliseconds: 0, stale: { kind: 'none' } },
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
    ] as const)
      expect(getEsiOperationContract(operation).cache).toEqual({ kind: 'none' })
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
      'EVE_SCOPES is missing scopes required by registered ESI operations: esi-characters.read_contacts.v1 esi-clones.read_clones.v1 esi-clones.read_implants.v1 esi-contracts.read_character_contracts.v1 esi-location.read_ship_type.v1 esi-mail.organize_mail.v1 esi-mail.read_mail.v1 esi-mail.send_mail.v1 esi-markets.read_character_orders.v1 esi-search.search_structures.v1 esi-skills.read_skillqueue.v1 esi-skills.read_skills.v1 esi-wallet.read_character_wallet.v1',
    )
  })

  test('accepts the reviewed date and configured private scopes without requiring SSO when disabled', () => {
    expect(() =>
      assertEsiOperationCatalogConfiguration({
        compatibilityDate: '2026-08-23',
        ssoEnabled: true,
        requestableScopes: [
          'esi-characters.read_contacts.v1',
          'esi-clones.read_clones.v1',
          'esi-clones.read_implants.v1',
          'esi-contracts.read_character_contracts.v1',
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

  test.each([
    'esi-clones.read_clones.v1',
    'esi-clones.read_implants.v1',
    'esi-markets.read_character_orders.v1',
    'esi-contracts.read_character_contracts.v1',
  ])('rejects configured SSO when %s is missing', (missingScope) => {
    const requestableScopes = [
      'esi-characters.read_contacts.v1',
      'esi-clones.read_clones.v1',
      'esi-clones.read_implants.v1',
      'esi-contracts.read_character_contracts.v1',
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
    ].filter((scope) => scope !== missingScope)

    expect(() =>
      assertEsiOperationCatalogConfiguration({
        compatibilityDate: '2026-08-23',
        ssoEnabled: true,
        requestableScopes,
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
      () => ({ ...validModuleOperation(), authorization: { kind: 'character', scope: 'wallet' } }),
      'invalid character scope',
    ],
    [
      'ordered identity',
      () => ({ ...validModuleOperation(), identity: { kind: 'ordered', fields: ['id', 'id'] } }),
      'invalid or duplicate ordered identity fields',
    ],
    [
      'set identity',
      () => ({
        ...validModuleOperation(),
        identity: { kind: 'set', field: 'ids', maximumItems: 0 },
      }),
      'set identity maximum must be a positive safe integer',
    ],
    [
      'freshness',
      () => ({ ...validModuleOperation(), freshness: { kind: 'relative', seconds: 0 } }),
      'relative freshness must use positive whole seconds',
    ],
    [
      'cache behavior',
      () => ({
        ...validModuleOperation(),
        cache: {
          ...validModuleOperation().cache,
          stale: { kind: 'bounded', milliseconds: 120_000 },
          retentionMilliseconds: 60_000,
        },
      }),
      'stale duration exceeds cache retention',
    ],
    [
      'rate group',
      () => ({
        ...validModuleOperation(),
        rateGroup: { kind: 'declared', group: 'Module Group', maximumTokens: 100, window: '15m' },
      }),
      'invalid declared rate-group metadata',
    ],
    [
      'retry policy',
      () => ({
        ...validModuleOperation(),
        retry: {
          kind: 'idempotent',
          attempts: 3,
          initialDelayMilliseconds: 2_000,
          maximumDelayMilliseconds: 1_000,
        },
      }),
      'invalid idempotent retry metadata',
    ],
    [
      'retry attempt budget',
      () => ({
        ...validModuleOperation(),
        retry: {
          kind: 'idempotent',
          attempts: 4,
          initialDelayMilliseconds: 500,
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
  ])(
    'rejects invalid contributed %s metadata before startup',
    (_field, createContract, message) => {
      expect(() => assertEsiOperationContracts({ 'module-operation': createContract() })).toThrow(
        message,
      )
    },
  )

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
          ssoEnabled: false,
          requestableScopes: [],
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
          ssoEnabled: false,
          requestableScopes: [],
        },
        { 'module-operation': validModuleOperation() },
      ),
    ).toThrow('compatibility configuration date must use YYYY-MM-DD')
  })
})

function validModuleOperation() {
  return {
    audit: { esiOperationId: 'GetModuleOperation', reviewedDate: '2026-08-18' },
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: { kind: 'ordered', fields: ['subjectId'] },
    freshness: { kind: 'relative', seconds: 60 },
    cache: {
      kind: 'shared',
      collapse: true,
      revalidate: true,
      stale: { kind: 'bounded', milliseconds: 30_000 },
      retentionMilliseconds: 60_000,
    },
    rateGroup: {
      kind: 'declared',
      group: 'module-group',
      maximumTokens: 100,
      window: '15m',
    },
    retry: {
      kind: 'idempotent',
      attempts: 3,
      initialDelayMilliseconds: 100,
      maximumDelayMilliseconds: 1_000,
    },
    compatibility: { minimumDate: '2026-01-01' },
    responseValidation: { kind: 'enabled' },
  } as const
}
