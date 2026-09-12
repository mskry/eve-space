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
  cachedUntil: '2026-08-20T12:05:00.000Z',
  validatedAt: '2026-08-20T12:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) => {
    if (definition.operation === 'character-contracts')
      return Promise.resolve(result({ contracts: [], page: 1, totalPages: 1 }))
    if (definition.operation === 'character-contract-items')
      return Promise.resolve(result({ items: [] }))
    return Promise.resolve(result({ bids: [] }))
  })
})

describe('character contracts service', () => {
  test('returns the callable contract snapshot without exposing counterparties', async () => {
    mocks.executeRepresentation.mockResolvedValueOnce(
      result({
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
            acceptedAt: null,
            completedAt: null,
            daysToComplete: null,
            startLocationId: null,
            endLocationId: null,
            price: 100,
            reward: null,
            collateral: null,
            buyout: null,
            volume: null,
          },
        ],
        page: 2,
        totalPages: 6,
      }),
    )
    const { characterContractsScope, getCharacterContracts } =
      await import('../../src/characters/contracts.js')

    const response = await getCharacterContracts(characterId, 2, subjectLifecycleId)

    expect(response).toMatchObject({ contracts: [{ contractId: 100, role: 'issued' }], page: 2 })
    expect(JSON.stringify(response)).not.toMatch(/issuer|assignee|acceptor/)
    expect(characterContractsScope).toBe('esi-contracts.read_character_contracts.v1')
    expect(mocks.executeRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'character-contracts' }),
      { characterId, page: 2, subjectLifecycleId },
      { subjectLifecycleId },
    )
  })

  test('requires a parent callable result before loading item detail', async () => {
    mocks.executeRepresentation
      .mockResolvedValueOnce(result({ contracts: [{ contractId: 300 }], page: 2, totalPages: 3 }))
      .mockResolvedValueOnce(
        result({
          items: [
            {
              recordId: 1,
              typeId: 34,
              typeName: 'Tritanium',
              direction: 'included',
              quantity: 3,
              isSingleton: true,
              blueprint: 'original',
            },
          ],
        }),
      )
    const { getCharacterContractItems } = await import('../../src/characters/contracts.js')

    await expect(
      getCharacterContractItems(characterId, 300, 2, subjectLifecycleId),
    ).resolves.toMatchObject({
      items: [{ recordId: 1, blueprint: 'original' }],
    })
    expect(
      mocks.executeRepresentation.mock.calls.map(([definition]) => definition.operation),
    ).toEqual(['character-contracts', 'character-contract-items'])
  })

  test('does not load detail when the parent callable excludes the contract', async () => {
    mocks.executeRepresentation.mockResolvedValueOnce(
      result({ contracts: [{ contractId: 501 }], page: 3, totalPages: 3 }),
    )
    const { ContractNotFoundError, getCharacterContractBids } =
      await import('../../src/characters/contracts.js')

    await expect(
      getCharacterContractBids(characterId, 500, 3, subjectLifecycleId),
    ).rejects.toBeInstanceOf(ContractNotFoundError)
    expect(mocks.executeRepresentation).toHaveBeenCalledOnce()
  })

  test('preserves parent failures and quota identity', async () => {
    const unavailable = new Error('parent unavailable')
    mocks.executeRepresentation.mockRejectedValueOnce(unavailable)
    const { getCharacterContractItems } = await import('../../src/characters/contracts.js')
    await expect(getCharacterContractItems(characterId, 600, 1, subjectLifecycleId)).rejects.toBe(
      unavailable,
    )

    const quotaError = new EsiQuotaError(30)
    mocks.executeRepresentation.mockRejectedValueOnce(quotaError)
    await expect(getCharacterContractItems(characterId, 600, 1, subjectLifecycleId)).rejects.toBe(
      quotaError,
    )
  })
})

function result<Data>(data: Data) {
  return { data, ...freshness }
}
