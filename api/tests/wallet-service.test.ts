import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createWalletClient: vi.fn(),
  getCharacterAccessToken: vi.fn(),
  getCharacterBalance: vi.fn(),
  getCharacterTransactions: vi.fn(),
  selectStaticTypes: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/wallet', () => ({
  createWalletClient: mocks.createWalletClient,
}))

vi.mock('../src/token-service.js', () => ({
  getCharacterAccessToken: mocks.getCharacterAccessToken,
}))

vi.mock('../src/esi-fetch.js', () => ({
  esiFetch: vi.fn(),
}))

vi.mock('../src/db/client.js', () => ({
  db: {
    select: () => ({
      from: () => ({ where: mocks.selectStaticTypes }),
    }),
  },
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
  mocks.getCharacterAccessToken.mockResolvedValue('access-token')
  mocks.createWalletClient.mockReturnValue({
    withMetadata: () => ({
      getCharacterBalance: mocks.getCharacterBalance,
      listCharacterTransactions: mocks.getCharacterTransactions,
    }),
  })
  mocks.selectStaticTypes.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('wallet service', () => {
  test('collapses concurrent requests and serves fresh cached data', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined
    mocks.getCharacterBalance.mockReturnValue(new Promise((resolve) => (resolveRequest = resolve)))
    const { getWalletBalance, walletScope } = await import('../src/wallet-service.js')

    const first = getWalletBalance(90000001)
    const second = getWalletBalance(90000001)
    resolveRequest?.(walletResponse(123.45, 'max-age=60'))

    await expect(first).resolves.toMatchObject({ balance: 123.45, source: 'esi', stale: false })
    await expect(second).resolves.toMatchObject({ balance: 123.45, source: 'esi', stale: false })
    await expect(getWalletBalance(90000001)).resolves.toMatchObject({
      source: 'cache',
      stale: false,
    })
    expect(mocks.getCharacterAccessToken).toHaveBeenCalledOnce()
    expect(mocks.getCharacterAccessToken).toHaveBeenCalledWith(90000001, walletScope)
    expect(mocks.getCharacterBalance).toHaveBeenCalledOnce()
  })

  test('revalidates expired entries and reuses data on 304', async () => {
    mocks.getCharacterBalance
      .mockResolvedValueOnce(walletResponse(250, 'max-age=0', { etag: 'v1' }))
      .mockRejectedValueOnce(
        esiError(304, {
          cache: { cacheControl: 'max-age=120', etag: 'v2' },
        }),
      )
    const { getWalletBalance } = await import('../src/wallet-service.js')

    await getWalletBalance(90000002)
    const result = await getWalletBalance(90000002)

    expect(result).toMatchObject({
      balance: 250,
      source: 'not-modified',
      stale: false,
      cachedUntil: '2026-08-20T12:02:00.000Z',
    })
    expect(mocks.getCharacterBalance).toHaveBeenLastCalledWith(90000002, {
      ifNoneMatch: 'v1',
      ifModifiedSince: undefined,
    })
  })

  test('starts a cooldown after a 429 without cached data', async () => {
    mocks.getCharacterBalance.mockRejectedValue(
      esiError(429, {
        headers: { 'retry-after': '30' },
      }),
    )
    const { getWalletBalance, WalletQuotaError } = await import('../src/wallet-service.js')

    await expect(getWalletBalance(90000003)).rejects.toEqual(new WalletQuotaError(30))
    await expect(getWalletBalance(90000003)).rejects.toMatchObject({ retryAfterSeconds: 30 })
    expect(mocks.getCharacterBalance).toHaveBeenCalledOnce()
  })

  test('returns stale cached data during a quota cooldown', async () => {
    mocks.getCharacterBalance
      .mockResolvedValueOnce(walletResponse(500, 'max-age=0'))
      .mockRejectedValueOnce(
        esiError(429, {
          headers: { 'retry-after': '45' },
        }),
      )
    const { getWalletBalance } = await import('../src/wallet-service.js')

    await getWalletBalance(90000004)
    const throttled = await getWalletBalance(90000004)
    const cooldown = await getWalletBalance(90000004)

    expect(throttled).toMatchObject({
      balance: 500,
      source: 'cache',
      stale: true,
      retryAt: '2026-08-20T12:00:45.000Z',
    })
    expect(cooldown).toEqual(throttled)
    expect(mocks.getCharacterBalance).toHaveBeenCalledTimes(2)
  })

  test('honors a low ESI error budget before making another request', async () => {
    mocks.getCharacterBalance.mockResolvedValue(
      walletResponse(
        750,
        'max-age=0',
        {},
        {
          remaining: 10,
          reset: 20,
        },
      ),
    )
    const { getWalletBalance } = await import('../src/wallet-service.js')

    await expect(getWalletBalance(90000005)).resolves.toMatchObject({ source: 'esi' })
    await expect(getWalletBalance(90000005)).resolves.toMatchObject({
      source: 'cache',
      stale: true,
      retryAt: '2026-08-20T12:00:20.000Z',
    })
    expect(mocks.getCharacterBalance).toHaveBeenCalledOnce()
  })

  test('uses stale data when an error response reports a low ESI budget', async () => {
    mocks.getCharacterBalance
      .mockResolvedValueOnce(walletResponse(800, 'max-age=0'))
      .mockRejectedValueOnce(
        esiError(500, {
          errorLimit: { remaining: 5, reset: 25 },
        }),
      )
    const { getWalletBalance } = await import('../src/wallet-service.js')

    await getWalletBalance(90000006)
    await expect(getWalletBalance(90000006)).resolves.toMatchObject({
      balance: 800,
      source: 'cache',
      stale: true,
      retryAt: '2026-08-20T12:00:25.000Z',
    })
  })

  test('preserves a low-budget ESI error when no stale data exists', async () => {
    const error = esiError(500, {
      errorLimit: { remaining: 5, reset: 25 },
    })
    mocks.getCharacterBalance.mockRejectedValue(error)
    const { getWalletBalance } = await import('../src/wallet-service.js')

    await expect(getWalletBalance(90000007)).rejects.toBe(error)
    await expect(getWalletBalance(90000007)).rejects.toMatchObject({ retryAfterSeconds: 25 })
    expect(mocks.getCharacterBalance).toHaveBeenCalledOnce()
  })

  test('falls back to a one-minute cache when ESI omits cache metadata', async () => {
    mocks.getCharacterBalance.mockResolvedValue({
      data: 900,
      meta: { headers: {} },
    })
    const { getWalletBalance } = await import('../src/wallet-service.js')

    await expect(getWalletBalance(90000008)).resolves.toMatchObject({
      balance: 900,
      cachedUntil: '2026-08-20T12:01:00.000Z',
      quota: {},
    })
  })

  test('uses an explicit future Expires value', async () => {
    mocks.getCharacterBalance.mockResolvedValue({
      data: 950,
      meta: {
        cache: { expires: '2026-08-20T12:05:00.000Z' },
        headers: {},
      },
    })
    const { getWalletBalance } = await import('../src/wallet-service.js')

    await expect(getWalletBalance(90000009)).resolves.toMatchObject({
      cachedUntil: '2026-08-20T12:05:00.000Z',
    })
  })

  test('reuses cached metadata when a 304 omits response metadata', async () => {
    mocks.getCharacterBalance
      .mockResolvedValueOnce(walletResponse(1000, 'max-age=0', { etag: 'v1' }))
      .mockRejectedValueOnce(Object.assign(new Error('Not modified'), { status: 304 }))
    const { getWalletBalance } = await import('../src/wallet-service.js')

    await getWalletBalance(90000010)
    await expect(getWalletBalance(90000010)).resolves.toMatchObject({
      balance: 1000,
      source: 'not-modified',
    })
  })

  test('evicts the oldest cache entry after 100 characters', async () => {
    mocks.getCharacterBalance.mockImplementation(async (characterId: number) =>
      walletResponse(characterId, 'max-age=60'),
    )
    const { getWalletBalance } = await import('../src/wallet-service.js')

    for (let characterId = 1; characterId <= 101; characterId += 1) {
      await getWalletBalance(characterId)
    }
    await getWalletBalance(1)

    expect(mocks.getCharacterBalance).toHaveBeenCalledTimes(102)
  })

  test('maps, enriches, sorts, and caches wallet transactions', async () => {
    mocks.getCharacterTransactions.mockResolvedValue(
      transactionResponse([
        transaction(2, '2026-08-19T12:00:00.000Z', 34, true),
        transaction(1, '2026-08-20T12:00:00.000Z', 35, false),
      ]),
    )
    mocks.selectStaticTypes.mockResolvedValue([
      { typeId: 34, typeName: 'Tritanium' },
      { typeId: 35, typeName: 'Pyerite' },
    ])
    const { getWalletTransactions, walletScope } = await import('../src/wallet-service.js')

    const first = await getWalletTransactions(90000101)
    const cached = await getWalletTransactions(90000101)

    expect(first.transactions.map((entry) => entry.transactionId)).toEqual([1, 2])
    expect(first.transactions[0]).toMatchObject({
      typeName: 'Pyerite',
      totalPrice: 50,
      isBuy: false,
    })
    expect(cached.source).toBe('cache')
    expect(mocks.getCharacterAccessToken).toHaveBeenCalledWith(90000101, walletScope)
    expect(mocks.getCharacterTransactions).toHaveBeenCalledOnce()
    expect(mocks.selectStaticTypes).toHaveBeenCalledOnce()
  })

  test('uses deterministic labels when static type data is missing', async () => {
    mocks.getCharacterTransactions.mockResolvedValue(
      transactionResponse([transaction(3, '2026-08-20T12:00:00.000Z', 99, true)]),
    )
    const { getWalletTransactions } = await import('../src/wallet-service.js')

    const result = await getWalletTransactions(90000102)

    expect(result.transactions[0]?.typeName).toBe('Unknown type 99')
  })

  test('skips the static-data query for an empty transaction batch', async () => {
    mocks.getCharacterTransactions.mockResolvedValue(transactionResponse([]))
    const { getWalletTransactions } = await import('../src/wallet-service.js')

    const result = await getWalletTransactions(90000103)

    expect(result.transactions).toEqual([])
    expect(mocks.selectStaticTypes).not.toHaveBeenCalled()
  })

  test('maps a transaction quota failure to the wallet error contract', async () => {
    mocks.getCharacterTransactions.mockRejectedValue(esiError(429, { headers: {} }))
    const { getWalletTransactions, WalletQuotaError } = await import('../src/wallet-service.js')

    await expect(getWalletTransactions(90000104)).rejects.toBeInstanceOf(WalletQuotaError)
  })
})

function walletResponse(
  balance: number,
  cacheControl: string,
  cache: Record<string, string> = {},
  errorLimit?: { remaining: number; reset: number },
) {
  return {
    data: balance,
    meta: {
      cache: { cacheControl, ...cache },
      errorLimit,
      headers: {
        'x-ratelimit-group': 'wallet',
        'x-ratelimit-limit': '150/15m',
        'x-ratelimit-remaining': '149',
        'x-ratelimit-used': '1',
      },
    },
  }
}

function esiError(status: number, metadata: Record<string, unknown>) {
  return Object.assign(new Error(`ESI ${status}`), {
    status,
    metadata: { headers: {}, ...metadata },
  })
}

function transaction(transactionId: number, date: string, typeId: number, isBuy: boolean) {
  return {
    client_id: 90_000_001,
    date,
    is_buy: isBuy,
    is_personal: true,
    journal_ref_id: transactionId + 100,
    location_id: 60_000_001,
    quantity: 5,
    transaction_id: transactionId,
    type_id: typeId,
    unit_price: 10,
  }
}

function transactionResponse(data: ReturnType<typeof transaction>[]) {
  return {
    data,
    meta: {
      cache: { cacheControl: 'max-age=60' },
      headers: {},
    },
  }
}
