import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cooldowns: vi.fn(),
  isLimited: vi.fn(),
}))

vi.mock('../../src/esi-gateway/internal/production-runtime.js', () => ({
  getProductionEsiExecutionRuntime: async () => ({
    getQuotaStatuses: mocks.cooldowns,
    isOperationQuotaLimited: mocks.isLimited,
  }),
}))

vi.mock('../../src/esi-gateway/internal/identity.js', () => ({
  characterEsiPrincipal: (characterId: number) => `character-${characterId}`,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isLimited.mockResolvedValue(false)
  mocks.cooldowns.mockResolvedValue([
    { active: false, retryAfterSeconds: null, coordinationAvailable: true },
  ])
})

describe('ESI quota interface', () => {
  test('checks operation admission without exposing a permit or connection', async () => {
    const { isEsiOperationQuotaLimited } = await import('../../src/esi-gateway/failures.js')

    await expect(isEsiOperationQuotaLimited('bulk-affiliation')).resolves.toBe(false)

    expect(mocks.isLimited).toHaveBeenCalledWith('bulk-affiliation')
  })

  test('classifies quota rejection through the stable error class', async () => {
    const { isEsiOperationQuotaLimited } = await import('../../src/esi-gateway/failures.js')
    mocks.isLimited.mockResolvedValue(true)

    await expect(isEsiOperationQuotaLimited('bulk-affiliation')).resolves.toBe(true)
  })

  test('accepts character identity and returns only safe aggregate cooldown state', async () => {
    const { getEsiQuotaStatuses } = await import('../../src/esi-gateway/failures.js')

    const statuses = await getEsiQuotaStatuses([
      { operation: 'skills', characterId: 2_112_625_428 },
    ])

    expect(mocks.cooldowns).toHaveBeenCalledWith([
      { operation: 'skills', principal: 'character-2112625428' },
    ])
    expect(statuses).toEqual([
      { active: false, retryAfterSeconds: null, coordinationAvailable: true },
    ])
    expect(JSON.stringify(statuses)).not.toContain('character-2112625428')
  })
})
