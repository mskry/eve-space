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
    getCharacterTransactions: vi.fn(),
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
  mocks.getCharacterTransactions.mockResolvedValue(response([]))
  mocks.selectStaticTypes.mockResolvedValue([])
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

  test('maps and sorts transactions without changing the response DTO', async () => {
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
    const { getWalletTransactions } = await import('../../src/characters/wallet.js')

    await expect(getWalletTransactions(90_000_004)).resolves.toMatchObject({
      transactions: [
        { transactionId: 1, typeName: 'Pyerite' },
        { transactionId: 2, typeName: 'Tritanium' },
      ],
    })
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}

function transaction(transactionId: number, date: string, typeId: number) {
  return {
    client_id: 90_000_001,
    date,
    is_buy: true,
    is_personal: true,
    location_id: 60_000_001,
    quantity: 5,
    transaction_id: transactionId,
    type_id: typeId,
    unit_price: 10,
  }
}
