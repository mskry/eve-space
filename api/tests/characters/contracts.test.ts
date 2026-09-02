import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class EsiQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('ESI quota is temporarily exhausted')
    }
  }

  return {
    EsiQuotaError,
    createContractsClient: vi.fn(),
    getCharacter: vi.fn(),
    listBids: vi.fn(),
    listContracts: vi.fn(),
    listItems: vi.fn(),
    loadTypeNames: vi.fn(),
  }
})

vi.mock('@evespace/esi-client/domains/contracts', () => ({
  createContractsClient: mocks.createContractsClient,
}))
vi.mock('../../src/esi-resilience/cooldowns.js', () => ({ EsiQuotaError: mocks.EsiQuotaError }))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.getCharacter }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))
vi.mock('../../src/characters/finance-type-names.js', () => ({
  loadFinanceTypeNames: mocks.loadTypeNames,
  financeTypeName: (typeId: number, names: ReadonlyMap<number, string>) =>
    names.get(typeId) ?? `Unknown type ${typeId}`,
}))

const characterId = 90_000_001
const authority = { accessToken: 'access-token', principal: `character-${characterId}` }
const revalidation = { ifNoneMatch: 'contract-etag' }
const outerMetadata = {
  cachedUntil: '2026-08-20T12:05:00.000Z',
  validatedAt: '2026-08-20T12:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}

beforeEach(() => {
  mocks.createContractsClient.mockReturnValue({
    withMetadata: () => ({
      listCharacterContracts: mocks.listContracts,
      listCharacterContractItems: mocks.listItems,
      listCharacterContractBids: mocks.listBids,
    }),
  })
  mocks.getCharacter.mockImplementation(async (resource) => {
    const loaded = await resource.load(authority, revalidation)
    return { data: loaded.data, ...outerMetadata }
  })
  mocks.listContracts.mockResolvedValue(response([], 1))
  mocks.listItems.mockResolvedValue(response([]))
  mocks.listBids.mockResolvedValue(response([]))
  mocks.loadTypeNames.mockResolvedValue(new Map())
})

describe('character contracts service', () => {
  test('maps applicable personal contract terms and omits every party identifier', async () => {
    mocks.listContracts.mockResolvedValue(
      response(
        [
          contract(100, {
            buyout: 300,
            collateral: 400,
            date_accepted: '2026-08-20T12:30:00Z',
            date_completed: '2026-08-21T12:30:00Z',
            days_to_complete: 2,
            end_location_id: 60_000_002,
            price: 100,
            reward: 200,
            start_location_id: 60_000_001,
            title: 'Delivery',
            volume: 50,
          }),
          contract(101, { for_corporation: true }),
        ],
        6,
      ),
    )
    const { characterContractsScope, getCharacterContracts } =
      await import('../../src/characters/contracts.js')

    const result = await getCharacterContracts(characterId, 2)

    expect(result).toEqual({
      contracts: [
        {
          contractId: 100,
          type: 'courier',
          status: 'outstanding',
          availability: 'personal',
          role: 'issued',
          title: 'Delivery',
          issuedAt: '2026-08-20T12:00:00Z',
          expiredAt: '2026-08-27T12:00:00Z',
          acceptedAt: '2026-08-20T12:30:00Z',
          completedAt: '2026-08-21T12:30:00Z',
          daysToComplete: 2,
          startLocationId: 60_000_001,
          endLocationId: 60_000_002,
          price: 100,
          reward: 200,
          collateral: 400,
          buyout: 300,
          volume: 50,
        },
      ],
      page: 2,
      totalPages: 6,
      cachedUntil: outerMetadata.cachedUntil,
      validatedAt: outerMetadata.validatedAt,
      stale: false,
    })
    expect(characterContractsScope).toBe('esi-contracts.read_character_contracts.v1')
    expect(mocks.listContracts).toHaveBeenCalledWith(characterId, { page: 2, ...revalidation })
    expect(JSON.stringify(result)).not.toMatch(
      /issuer|assignee|acceptor|corporationId|90000002|98000001/,
    )
  })

  test('derives the contract role from the assignee or acceptor without exposing identifiers', async () => {
    mocks.listContracts.mockResolvedValue(
      response(
        [
          contract(110, { assignee_id: characterId }),
          contract(111, { acceptor_id: characterId, assignee_id: 0 }),
          contract(112, { assignee_id: 90_000_002 }),
        ],
        1,
      ),
    )
    const { getCharacterContracts } = await import('../../src/characters/contracts.js')

    const result = await getCharacterContracts(characterId, 1)

    expect(result.contracts.map((entry) => [entry.contractId, entry.role])).toEqual([
      [110, 'assigned'],
      [111, 'assigned'],
      [112, 'issued'],
    ])
    expect(JSON.stringify(result)).not.toMatch(/assignee|issuer|acceptor/)
  })

  test('preserves a sparse page and nullable inapplicable terms', async () => {
    mocks.listContracts.mockResolvedValue(
      response([contract(200, { for_corporation: true }), contract(201)], 4),
    )
    const { getCharacterContracts } = await import('../../src/characters/contracts.js')

    await expect(getCharacterContracts(characterId, 4)).resolves.toMatchObject({
      contracts: [
        {
          contractId: 201,
          title: null,
          acceptedAt: null,
          completedAt: null,
          daysToComplete: null,
          startLocationId: null,
          endLocationId: null,
          price: null,
          reward: null,
          collateral: null,
          buyout: null,
          volume: null,
        },
      ],
      page: 4,
      totalPages: 4,
    })
  })

  test('retains page and stale metadata from a cached parent representation', async () => {
    mocks.getCharacter.mockResolvedValueOnce({
      data: { contracts: [], page: 5, totalPages: 7 },
      cachedUntil: '2026-08-20T11:00:00.000Z',
      validatedAt: '2026-08-20T10:00:00.000Z',
      quota: {},
      source: 'cache',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
    const { getCharacterContracts } = await import('../../src/characters/contracts.js')

    await expect(getCharacterContracts(characterId, 5)).resolves.toEqual({
      contracts: [],
      page: 5,
      totalPages: 7,
      cachedUntil: '2026-08-20T11:00:00.000Z',
      validatedAt: '2026-08-20T10:00:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
    expect(mocks.listContracts).not.toHaveBeenCalled()
  })

  test('checks a cached personal parent before reading and mapping item detail', async () => {
    serveParentThenDetail({ contracts: [{ contractId: 300 }], page: 2, totalPages: 3 })
    mocks.listItems.mockResolvedValue(
      response([
        item(1, 34, { is_included: true, is_singleton: true, raw_quantity: -1 }),
        item(2, 35, { raw_quantity: -2 }),
        item(3, 36),
      ]),
    )
    mocks.loadTypeNames.mockResolvedValue(new Map([[35, 'Blueprint Copy']]))
    const { getCharacterContractItems } = await import('../../src/characters/contracts.js')

    const result = await getCharacterContractItems(characterId, 300, 2)

    expect(result).toMatchObject({
      items: [
        {
          recordId: 1,
          typeName: 'Unknown type 34',
          direction: 'included',
          isSingleton: true,
          blueprint: 'original',
        },
        {
          recordId: 2,
          typeName: 'Blueprint Copy',
          direction: 'requested',
          blueprint: 'copy',
        },
        { recordId: 3, typeName: 'Unknown type 36', blueprint: null },
      ],
    })
    expect(mocks.getCharacter.mock.calls.map(([resource]) => resource.operation)).toEqual([
      'character-contracts',
      'character-contract-items',
    ])
    expect(mocks.getCharacter.mock.calls[0]?.[0].inputs).toEqual({ characterId, page: 2 })
    expect(mocks.getCharacter.mock.calls[1]?.[0].inputs).toEqual({ characterId, contractId: 300 })
    expect(mocks.listItems).toHaveBeenCalledWith(characterId, 300, revalidation)
  })

  test('accepts an outage-stale personal parent before loading bid detail', async () => {
    serveParentThenDetail(
      { contracts: [{ contractId: 400 }], page: 1, totalPages: 1 },
      { stale: true, refreshFailureClass: 'esi-unavailable' },
    )
    mocks.listBids.mockResolvedValue(
      response([
        { amount: 250, bid_id: 20, bidder_id: 90_000_002, date_bid: '2026-08-20T13:00:00Z' },
      ]),
    )
    const { getCharacterContractBids } = await import('../../src/characters/contracts.js')

    const result = await getCharacterContractBids(characterId, 400, 1)

    expect(result).toMatchObject({
      bids: [{ bidId: 20, amount: 250, bidAt: '2026-08-20T13:00:00Z' }],
    })
    expect(JSON.stringify(result)).not.toContain('90000002')
    expect(mocks.getCharacter.mock.calls.map(([resource]) => resource.operation)).toEqual([
      'character-contracts',
      'character-contract-bids',
    ])
  })

  test.each(['items', 'bids'] as const)(
    'returns deterministic not-found for ineligible %s before detail cache access',
    async (detail) => {
      mocks.getCharacter.mockResolvedValueOnce({
        data: { contracts: [{ contractId: 501 }], page: 3, totalPages: 3 },
        ...outerMetadata,
        source: 'cache',
      })
      const module = await import('../../src/characters/contracts.js')
      const request =
        detail === 'items'
          ? module.getCharacterContractItems(characterId, 500, 3)
          : module.getCharacterContractBids(characterId, 500, 3)

      await expect(request).rejects.toBeInstanceOf(module.ContractNotFoundError)
      expect(mocks.getCharacter).toHaveBeenCalledOnce()
      expect(mocks.listItems).not.toHaveBeenCalled()
      expect(mocks.listBids).not.toHaveBeenCalled()
    },
  )

  test('propagates parent unavailability without converting it to not-found or reading detail', async () => {
    const failure = new Error('parent unavailable')
    mocks.getCharacter.mockRejectedValueOnce(failure)
    const { getCharacterContractItems } = await import('../../src/characters/contracts.js')

    await expect(getCharacterContractItems(characterId, 600, 1)).rejects.toBe(failure)
    expect(mocks.getCharacter).toHaveBeenCalledOnce()
    expect(mocks.listItems).not.toHaveBeenCalled()
  })

  test('maps parent quota failure and never reads detail cache', async () => {
    mocks.getCharacter.mockRejectedValueOnce(new mocks.EsiQuotaError(30))
    const { ContractQuotaError, getCharacterContractBids } =
      await import('../../src/characters/contracts.js')

    await expect(getCharacterContractBids(characterId, 700, 1)).rejects.toEqual(
      new ContractQuotaError(30),
    )
    expect(mocks.getCharacter).toHaveBeenCalledOnce()
    expect(mocks.listBids).not.toHaveBeenCalled()
  })

  test('maps detail quota failure after successful parent eligibility', async () => {
    mocks.getCharacter
      .mockResolvedValueOnce({
        data: { contracts: [{ contractId: 800 }], page: 1, totalPages: 1 },
        ...outerMetadata,
        source: 'cache',
      })
      .mockRejectedValueOnce(new mocks.EsiQuotaError(20))
    const { ContractQuotaError, getCharacterContractItems } =
      await import('../../src/characters/contracts.js')

    await expect(getCharacterContractItems(characterId, 800, 1)).rejects.toEqual(
      new ContractQuotaError(20),
    )
    expect(mocks.getCharacter).toHaveBeenCalledTimes(2)
  })

  test.each([undefined, 0])(
    'defaults missing or zero contract pages to the requested page',
    async (pages) => {
      mocks.listContracts.mockResolvedValue(response([], pages))
      const { getCharacterContracts } = await import('../../src/characters/contracts.js')

      await expect(getCharacterContracts(characterId, 3)).resolves.toMatchObject({
        page: 3,
        totalPages: 3,
      })
    },
  )
})

function serveParentThenDetail(
  data: { contracts: Array<{ contractId: number }>; page: number; totalPages: number },
  metadata: Partial<typeof outerMetadata & { refreshFailureClass: string }> = {},
) {
  mocks.getCharacter.mockImplementation(async (resource) => {
    if (resource.operation === 'character-contracts')
      return { data, ...outerMetadata, source: 'cache', ...metadata }
    const loaded = await resource.load(authority, revalidation)
    return { data: loaded.data, ...outerMetadata }
  })
}

function response<Data>(data: Data, pages?: number) {
  return {
    data,
    meta: {
      status: 200,
      headers: {},
      ...(pages === undefined ? {} : { pagination: { pages } }),
    },
  }
}

function contract(contractId: number, overrides: Record<string, unknown> = {}) {
  return {
    acceptor_id: 90_000_002,
    assignee_id: 90_000_002,
    availability: 'personal' as const,
    contract_id: contractId,
    date_expired: '2026-08-27T12:00:00Z',
    date_issued: '2026-08-20T12:00:00Z',
    for_corporation: false,
    issuer_corporation_id: 98_000_001,
    issuer_id: 90_000_002,
    status: 'outstanding' as const,
    type: 'courier' as const,
    ...overrides,
  }
}

function item(recordId: number, typeId: number, overrides: Record<string, unknown> = {}) {
  return {
    is_included: false,
    is_singleton: false,
    quantity: 3,
    record_id: recordId,
    type_id: typeId,
    ...overrides,
  }
}
