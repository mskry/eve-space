import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({ executeRepresentation: vi.fn() }))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

const characterId = 90_000_001
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const freshness = {
  cachedUntil: '2026-08-20T12:01:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
  validatedAt: '2026-08-20T12:00:00.000Z',
}

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) => {
    if (definition.operation === 'wallet-balance') {
      return Promise.resolve(result(123.45))
    }
    if (definition.operation === 'wallet-journal') {
      return Promise.resolve(result({ entries: [], page: 1, totalPages: 1 }))
    }
    return Promise.resolve(result({ fromId: null, nextFromId: null, transactions: [] }))
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
    expect(balance).toStrictEqual({
      balance: 500,
      cachedUntil: freshness.cachedUntil,
      stale: false,
      validatedAt: freshness.validatedAt,
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
              amount: -50,
              balance: 950,
              context: { id: 60_000_001, type: 'station_id' },
              date: '2026-08-20T12:00:00Z',
              description: 'Market transaction',
              journalId: 501,
              reason: 'purchase',
              referenceType: 'market_transaction',
              taxAmount: 3.5,
            },
          ],
          page: 2,
          totalPages: 4,
        }),
      )
      .mockResolvedValueOnce(
        result({
          fromId: null,
          nextFromId: null,
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
        }),
      )
    const { getWalletJournal, getWalletTransactions } =
      await import('../../src/characters/wallet.js')

    await expect(getWalletJournal(characterId, 2, subjectLifecycleId)).resolves.toMatchObject({
      entries: [{ context: { type: 'station_id' }, journalId: 501 }],
      page: 2,
    })
    await expect(
      getWalletTransactions(characterId, undefined, subjectLifecycleId),
    ).resolves.toMatchObject({
      fromId: null,
      transactions: [{ transactionId: 1, typeName: 'Pyerite' }],
    })
  })

  test('propagates callable quota identity and rejects invalid local input before execution', async () => {
    const quotaError = new EsiQuotaError(30)
    mocks.executeRepresentation.mockRejectedValueOnce(quotaError)
    const { getWalletBalance, getWalletTransactions } =
      await import('../../src/characters/wallet.js')

    await expect(getWalletBalance(characterId, subjectLifecycleId)).rejects.toBe(quotaError)
    await expect(getWalletTransactions(characterId, 0, subjectLifecycleId)).rejects.toThrow(
      'Wallet transaction continuation must be a positive safe integer',
    )
  })
})

function result<Data>(data: Data) {
  return { data, ...freshness }
}
