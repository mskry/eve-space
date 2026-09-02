import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class EsiQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('ESI quota is temporarily exhausted')
    }
  }

  return {
    EsiQuotaError,
    createWalletClient: vi.fn(),
    get: vi.fn(),
    getCharacterAuthorization: vi.fn(),
    getCharacterBalance: vi.fn(),
    getCharacterJournal: vi.fn(),
    getCharacterTransactions: vi.fn(),
    loadLocationNames: vi.fn(),
    selectStaticTypes: vi.fn(),
  }
})

vi.mock('@evespace/esi-client/domains/wallet', () => ({
  createWalletClient: mocks.createWalletClient,
}))

vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorization: mocks.getCharacterAuthorization,
}))

vi.mock('../../src/esi-resilience/cooldowns.js', () => ({ EsiQuotaError: mocks.EsiQuotaError }))

vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.get }),
}))

vi.mock('../../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))

vi.mock('../../src/characters/finance-location-names.js', () => ({
  loadFinanceLocationNames: mocks.loadLocationNames,
  financeLocationName: (locationId: number, names: ReadonlyMap<number, string>) =>
    names.get(locationId) ?? null,
}))

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: () => ({
      from: () => ({ where: mocks.selectStaticTypes }),
    }),
  },
}))

beforeEach(() => {
  mocks.getCharacterAuthorization.mockResolvedValue({
    accessToken: 'access-token',
    tokenVersion: 4,
  })
  mocks.createWalletClient.mockReturnValue({
    withMetadata: () => ({
      getCharacterBalance: mocks.getCharacterBalance,
      listCharacterJournal: mocks.getCharacterJournal,
      listCharacterTransactions: mocks.getCharacterTransactions,
    }),
  })
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load(
      { accessToken: 'access-token', principal: 'character-90000001' },
      {},
    )
    return {
      data: loaded.data,
      cachedUntil: '2026-08-20T12:01:00.000Z',
      validatedAt: '2026-08-20T12:00:00.000Z',
      quota: { remaining: 149 },
      source: 'esi',
      stale: false,
    }
  })
  mocks.getCharacterBalance.mockResolvedValue(response(123.45))
  mocks.getCharacterJournal.mockResolvedValue(response([], 1))
  mocks.getCharacterTransactions.mockResolvedValue(response([]))
  mocks.selectStaticTypes.mockResolvedValue([])
  mocks.loadLocationNames.mockResolvedValue(new Map())
})

describe('wallet service', () => {
  test('passes the private wallet operation to the authorization-aware layer', async () => {
    const calls: string[] = []
    mocks.get.mockImplementation(async (resource) => {
      calls.push('cache-read')
      const loaded = await resource.load(
        { accessToken: 'access-token', principal: 'character-90000001' },
        {},
      )
      return {
        data: loaded.data,
        cachedUntil: '2026-08-20T12:01:00.000Z',
        validatedAt: '2026-08-20T12:00:00.000Z',
        quota: {},
        source: 'esi',
        stale: false,
      }
    })
    const { getWalletBalance, walletScope } = await import('../../src/characters/wallet.js')

    await expect(getWalletBalance(90_000_001)).resolves.toMatchObject({
      balance: 123.45,
      validatedAt: '2026-08-20T12:00:00.000Z',
    })

    expect(calls).toEqual(['cache-read'])
    expect(walletScope).toBe('esi-wallet.read_character_wallet.v1')
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'wallet-balance',
      inputs: { characterId: 90_000_001 },
    })
  })

  test('preserves cache freshness without publishing internal provenance or quota', async () => {
    mocks.get.mockResolvedValueOnce({
      data: 500,
      cachedUntil: '2026-08-20T12:05:00.000Z',
      validatedAt: '2026-08-20T12:00:00.000Z',
      quota: {},
      source: 'cache',
      stale: false,
    })
    const { getWalletBalance } = await import('../../src/characters/wallet.js')

    await expect(getWalletBalance(90_000_002)).resolves.toEqual({
      balance: 500,
      cachedUntil: '2026-08-20T12:05:00.000Z',
      validatedAt: '2026-08-20T12:00:00.000Z',
      stale: false,
    })
    expect(mocks.getCharacterBalance).not.toHaveBeenCalled()
  })

  test('projects freshness from a not-modified resilient envelope refresh', async () => {
    mocks.get.mockResolvedValueOnce({
      data: 500,
      cachedUntil: '2026-08-20T12:05:00.000Z',
      validatedAt: '2026-08-20T12:00:00.000Z',
      quota: { remaining: 100 },
      source: 'not-modified',
      stale: false,
    })
    const { getWalletBalance } = await import('../../src/characters/wallet.js')

    await expect(getWalletBalance(90_000_005)).resolves.toMatchObject({
      balance: 500,
      validatedAt: '2026-08-20T12:00:00.000Z',
    })
  })

  test('preserves an authorization rejection before invoking the SDK', async () => {
    const scopeError = new Error('Scope revoked')
    mocks.get.mockRejectedValueOnce(scopeError)
    const { getWalletBalance } = await import('../../src/characters/wallet.js')

    await expect(getWalletBalance(90_000_006)).rejects.toBe(scopeError)
    expect(mocks.getCharacterBalance).not.toHaveBeenCalled()
  })

  test('maps a shared global cooldown to the existing wallet quota error', async () => {
    mocks.get.mockRejectedValueOnce(new mocks.EsiQuotaError(30))
    const { getWalletBalance, WalletQuotaError } = await import('../../src/characters/wallet.js')

    await expect(getWalletBalance(90_000_003)).rejects.toEqual(new WalletQuotaError(30))
    expect(mocks.getCharacterBalance).not.toHaveBeenCalled()
  })

  test('maps journal values and only permits non-party typed context', async () => {
    mocks.getCharacterJournal.mockResolvedValue(
      response(
        [
          {
            amount: -50,
            balance: 950,
            context_id: 60_000_001,
            context_id_type: 'station_id',
            date: '2026-08-20T12:00:00Z',
            description: 'Market transaction',
            first_party_id: 90_000_001,
            id: 501,
            reason: 'purchase',
            ref_type: 'market_transaction',
            second_party_id: 90_000_002,
            tax: 3.5,
            tax_receiver_id: 98_000_001,
          },
          {
            context_id: 90_000_002,
            context_id_type: 'character_id',
            date: '2026-08-19T12:00:00Z',
            description: 'Donation',
            id: 500,
            ref_type: 'player_donation',
          },
        ],
        4,
      ),
    )
    const { getWalletJournal } = await import('../../src/characters/wallet.js')

    const result = await getWalletJournal(90_000_004, 2)

    expect(result).toEqual({
      entries: [
        {
          journalId: 501,
          date: '2026-08-20T12:00:00Z',
          amount: -50,
          balance: 950,
          referenceType: 'market_transaction',
          description: 'Market transaction',
          reason: 'purchase',
          taxAmount: 3.5,
          context: { id: 60_000_001, type: 'station_id' },
        },
        {
          journalId: 500,
          date: '2026-08-19T12:00:00Z',
          amount: null,
          balance: null,
          referenceType: 'player_donation',
          description: 'Donation',
          reason: null,
          taxAmount: null,
          context: null,
        },
      ],
      page: 2,
      totalPages: 4,
      cachedUntil: '2026-08-20T12:01:00.000Z',
      validatedAt: '2026-08-20T12:00:00.000Z',
      stale: false,
    })
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'wallet-journal',
      inputs: { characterId: 90_000_004, page: 2 },
    })
    expect(mocks.getCharacterJournal).toHaveBeenCalledWith(90_000_004, { page: 2 })
    expect(JSON.stringify(result)).not.toMatch(
      /firstParty|secondParty|taxReceiver|90000002|98000001/,
    )
  })

  test('retains journal pagination and stale freshness from a cache hit', async () => {
    mocks.get.mockResolvedValueOnce({
      data: { entries: [], page: 3, totalPages: 7 },
      cachedUntil: '2026-08-20T11:00:00.000Z',
      validatedAt: '2026-08-20T10:00:00.000Z',
      quota: {},
      source: 'cache',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
    const { getWalletJournal } = await import('../../src/characters/wallet.js')

    await expect(getWalletJournal(90_000_004, 3)).resolves.toEqual({
      entries: [],
      page: 3,
      totalPages: 7,
      cachedUntil: '2026-08-20T11:00:00.000Z',
      validatedAt: '2026-08-20T10:00:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
    })
    expect(mocks.getCharacterJournal).not.toHaveBeenCalled()
  })

  test('forwards journal conditional validators independently', async () => {
    mocks.get.mockImplementationOnce(async (resource) => {
      const loaded = await resource.load(
        { accessToken: 'access-token', principal: 'character-90000001' },
        { ifNoneMatch: 'journal-etag', ifModifiedSince: 'Wed, 19 Aug 2026 12:00:00 GMT' },
      )
      return {
        data: loaded.data,
        cachedUntil: '',
        validatedAt: '',
        quota: {},
        source: 'esi',
        stale: false,
      }
    })
    const { getWalletJournal } = await import('../../src/characters/wallet.js')

    await getWalletJournal(90_000_004, 1)

    expect(mocks.getCharacterJournal).toHaveBeenCalledWith(90_000_004, {
      page: 1,
      ifNoneMatch: 'journal-etag',
      ifModifiedSince: 'Wed, 19 Aug 2026 12:00:00 GMT',
    })
  })

  test('maps and deterministically sorts personal transactions without counterparties', async () => {
    mocks.getCharacterTransactions.mockResolvedValue(
      response([
        transaction(2, '2026-08-19T12:00:00.000Z', 34),
        transaction(1, '2026-08-20T12:00:00.000Z', 35),
      ]),
    )
    mocks.selectStaticTypes.mockResolvedValue([
      { typeId: 34, typeName: 'Tritanium' },
      { typeId: 35, typeName: 'Pyerite' },
    ])
    mocks.loadLocationNames.mockResolvedValue(new Map([[60_000_001, 'Jita IV - Moon 4']]))
    const { getWalletTransactions } = await import('../../src/characters/wallet.js')

    const result = await getWalletTransactions(90_000_004)
    expect(result).toMatchObject({
      transactions: [
        {
          transactionId: 1,
          journalRefId: 1001,
          typeName: 'Pyerite',
          locationName: 'Jita IV - Moon 4',
        },
        {
          transactionId: 2,
          journalRefId: 1002,
          typeName: 'Tritanium',
          locationName: 'Jita IV - Moon 4',
        },
      ],
      fromId: null,
      nextFromId: null,
    })
    expect(JSON.stringify(result)).not.toMatch(/clientId|isPersonal|90000001/)
  })

  test('keys and forwards each transaction continuation independently', async () => {
    const { getWalletTransactions } = await import('../../src/characters/wallet.js')

    await getWalletTransactions(90_000_004, 700)
    await getWalletTransactions(90_000_004, 600)

    expect(mocks.get.mock.calls.map(([resource]) => resource.inputs)).toEqual([
      { characterId: 90_000_004, fromId: 700 },
      { characterId: 90_000_004, fromId: 600 },
    ])
    expect(mocks.getCharacterTransactions).toHaveBeenNthCalledWith(1, 90_000_004, { fromId: 700 })
    expect(mocks.getCharacterTransactions).toHaveBeenNthCalledWith(2, 90_000_004, { fromId: 600 })
  })

  test('advances from the unfiltered full batch when every transaction is non-personal', async () => {
    mocks.getCharacterTransactions.mockResolvedValue(
      response(
        Array.from({ length: 2_500 }, (_, index) => ({
          ...transaction(2_500 - index, '2026-08-19T12:00:00.000Z', 34),
          is_personal: false,
        })),
      ),
    )
    const { getWalletTransactions } = await import('../../src/characters/wallet.js')

    await expect(getWalletTransactions(90_000_004, 3_000)).resolves.toMatchObject({
      transactions: [],
      fromId: 3_000,
      nextFromId: 1,
    })
    expect(mocks.selectStaticTypes).not.toHaveBeenCalled()
  })

  test('derives continuation and type names independently of upstream row order', async () => {
    mocks.getCharacterTransactions.mockResolvedValue(
      response([
        transaction(80, '2026-08-18T12:00:00.000Z', 35),
        transaction(100, '2026-08-20T12:00:00.000Z', 34),
        transaction(60, '2026-08-19T12:00:00.000Z', 36),
      ]),
    )
    mocks.selectStaticTypes.mockResolvedValue([
      { typeId: 36, typeName: 'Mexallon' },
      { typeId: 34, typeName: 'Tritanium' },
    ])
    const { getWalletTransactions } = await import('../../src/characters/wallet.js')

    await expect(getWalletTransactions(90_000_004)).resolves.toMatchObject({
      transactions: [
        { transactionId: 100, typeName: 'Tritanium' },
        { transactionId: 60, typeName: 'Mexallon' },
        { transactionId: 80, typeName: 'Unknown type 35' },
      ],
      nextFromId: null,
    })
  })

  test('does not offer an older range after a short final transaction page', async () => {
    mocks.getCharacterTransactions.mockResolvedValue(
      response([transaction(40, '2026-08-19T12:00:00.000Z', 34)]),
    )
    const { getWalletTransactions } = await import('../../src/characters/wallet.js')

    await expect(getWalletTransactions(90_000_004, 50)).resolves.toMatchObject({
      fromId: 50,
      nextFromId: null,
    })
  })

  test.each([0, -1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid transaction continuation %s before cache or ESI access',
    async (fromId) => {
      const { getWalletTransactions } = await import('../../src/characters/wallet.js')

      await expect(getWalletTransactions(90_000_004, fromId)).rejects.toThrow(
        'Wallet transaction continuation must be a positive safe integer',
      )
      expect(mocks.get).not.toHaveBeenCalled()
    },
  )

  test.each([undefined, 0])(
    'defaults missing or zero page metadata to the requested page',
    async (pages) => {
      mocks.getCharacterJournal.mockResolvedValue(response([], pages))
      const { getWalletJournal } = await import('../../src/characters/wallet.js')

      await expect(getWalletJournal(90_000_004, 3)).resolves.toMatchObject({
        page: 3,
        totalPages: 3,
      })
    },
  )
})

function response<Data>(data: Data, pages?: number) {
  return { data, meta: { headers: {}, ...(pages === undefined ? {} : { pagination: { pages } }) } }
}

function transaction(transactionId: number, date: string, typeId: number) {
  return {
    client_id: 90_000_001,
    date,
    is_buy: true,
    is_personal: true,
    journal_ref_id: 1000 + transactionId,
    location_id: 60_000_001,
    quantity: 5,
    transaction_id: transactionId,
    type_id: typeId,
    unit_price: 10,
  }
}
