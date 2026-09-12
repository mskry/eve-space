import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => {
  class EsiQuotaError extends Error {
    constructor(readonly retryAfterSeconds: number) {
      super('ESI quota is temporarily exhausted')
    }
  }
  return { EsiQuotaError, executeRepresentation: vi.fn() }
})

vi.mock('../../src/esi-gateway/failures.js', () => ({ EsiQuotaError: mocks.EsiQuotaError }))
vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

const characterId = 90_000_001
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const freshness = {
  cachedUntil: '2026-08-20T12:01:00.000Z',
  validatedAt: '2026-08-20T12:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) => {
    if (definition.operation === 'wallet-balance') return Promise.resolve(result(123.45))
    if (definition.operation === 'wallet-journal')
      return Promise.resolve(result({ entries: [], page: 1, totalPages: 1 }))
    return Promise.resolve(result({ transactions: [], fromId: null, nextFromId: null }))
  })
})

describe('wallet service', () => {
  test('passes the private wallet operation to the registered callable', async () => {
    const { getWalletBalance, walletScope } = await import('../../src/characters/wallet.js')

    await expect(getWalletBalance(characterId, subjectLifecycleId)).resolves.toMatchObject({
      balance: 123.45,
      validatedAt: freshness.validatedAt,
    })
    expect(walletScope).toBe('esi-wallet.read_character_wallet.v1')
    expect(mocks.executeRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'wallet-balance' }),
      { characterId, subjectLifecycleId },
      { subjectLifecycleId },
    )
  })

  test('preserves callable freshness without publishing provenance or quota', async () => {
    mocks.executeRepresentation.mockResolvedValueOnce({ ...result(500), source: 'cache' })
    const { getWalletBalance } = await import('../../src/characters/wallet.js')

    const balance = await getWalletBalance(90_000_002, subjectLifecycleId)
    expect(balance).toEqual({
      balance: 500,
      cachedUntil: freshness.cachedUntil,
      validatedAt: freshness.validatedAt,
      stale: false,
    })
    expect(balance).not.toHaveProperty('source')
    expect(balance).not.toHaveProperty('quota')
  })

  test('returns mapped journal and transaction snapshots', async () => {
    mocks.executeRepresentation
      .mockResolvedValueOnce(
        result({
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
          ],
          page: 2,
          totalPages: 4,
        }),
      )
      .mockResolvedValueOnce(
        result({
          transactions: [
            {
              transactionId: 1,
              journalRefId: 1001,
              date: '2026-08-20T12:00:00Z',
              typeId: 35,
              typeName: 'Pyerite',
              quantity: 5,
              unitPrice: 10,
              totalPrice: 50,
              isBuy: true,
              locationId: 60_000_001,
              locationName: 'Jita IV - Moon 4',
            },
          ],
          fromId: null,
          nextFromId: null,
        }),
      )
    const { getWalletJournal, getWalletTransactions } =
      await import('../../src/characters/wallet.js')

    await expect(getWalletJournal(characterId, 2, subjectLifecycleId)).resolves.toMatchObject({
      entries: [{ journalId: 501, context: { type: 'station_id' } }],
      page: 2,
    })
    await expect(
      getWalletTransactions(characterId, undefined, subjectLifecycleId),
    ).resolves.toMatchObject({
      transactions: [{ transactionId: 1, typeName: 'Pyerite' }],
      fromId: null,
    })
  })

  test('maps callable quota failures and rejects invalid local input before execution', async () => {
    mocks.executeRepresentation.mockRejectedValueOnce(new mocks.EsiQuotaError(30))
    const { getWalletBalance, getWalletTransactions, WalletQuotaError } =
      await import('../../src/characters/wallet.js')

    await expect(getWalletBalance(characterId, subjectLifecycleId)).rejects.toEqual(
      new WalletQuotaError(30),
    )
    await expect(getWalletTransactions(characterId, 0, subjectLifecycleId)).rejects.toThrow(
      'Wallet transaction continuation must be a positive safe integer',
    )
  })
})

function result<Data>(data: Data) {
  return { data, ...freshness }
}
