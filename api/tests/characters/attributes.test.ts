import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  cacheDel: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  commit: vi.fn(),
  createEsiClient: vi.fn(),
  getAttributes: vi.fn(),
  getCharacterAuthorization: vi.fn(),
  getCharacterCacheAuthorization: vi.fn(),
  getCommitted: vi.fn(),
  getLeaseTtl: vi.fn(),
  getRevision: vi.fn(),
  incrementRevision: vi.fn(),
  initialize: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(),
}))

vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorizationForLifecycle: mocks.getCharacterAuthorization,
  getCharacterCacheAuthorizationForLifecycle: mocks.getCharacterCacheAuthorization,
}))
vi.mock('../../src/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({
    del: mocks.cacheDel,
    get: mocks.cacheGet,
    ping: vi.fn().mockResolvedValue('PONG'),
    set: mocks.cacheSet,
  }),
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock((_definition, input) => mocks.getAttributes(input)),
)

const characterId = 1_404_328_063
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const scope = 'esi-skills.read_skills.v1'
const now = Date.parse('2026-09-01T11:00:00.000Z')
const lease = { fence: 7, key: 'lease', ownerToken: 'owner', ttlMs: 15_000 }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.resetModules()
  mocks.getAttributes.mockReset()
  mocks.createEsiClient.mockReset()
  mocks.getCharacterAuthorization.mockReset()
  mocks.getCharacterCacheAuthorization.mockReset()
  mocks.acquire.mockReset()
  mocks.commit.mockReset()
  mocks.getCommitted.mockReset()
  mocks.getLeaseTtl.mockReset()
  mocks.getRevision.mockReset()
  mocks.incrementRevision.mockReset()
  mocks.initialize.mockReset()
  mocks.release.mockReset()
  mocks.renew.mockReset()
  mocks.cacheGet.mockReset()
  mocks.cacheSet.mockReset()
  mocks.cacheDel.mockReset()

  mocks.getCharacterAuthorization.mockResolvedValue({
    accessToken: 'access-token',
    tokenVersion: 1,
  })
  mocks.getCharacterCacheAuthorization.mockResolvedValue({ scopes: [scope], tokenVersion: 1 })
  mocks.acquire.mockResolvedValue(lease)
  mocks.commit.mockResolvedValue(true)
  mocks.getCommitted.mockResolvedValue(undefined)
  mocks.getLeaseTtl.mockResolvedValue(0)
  mocks.initialize.mockResolvedValue('namespace-one')
  mocks.release.mockResolvedValue(true)
  mocks.renew.mockResolvedValue(true)
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue('OK')
  mocks.cacheDel.mockResolvedValue(1)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('character attributes', () => {
  test('loads and maps attributes through the registered execution seam', async () => {
    mocks.getAttributes.mockResolvedValue(
      response({
        accrued_remap_cooldown_date: '2026-10-01T12:00:00Z',
        bonus_remaps: 2,
        charisma: 19,
        intelligence: 27,
        last_remap_date: '2025-10-01T12:00:00Z',
        memory: 23,
        perception: 24,
        willpower: 21,
      }),
    )
    const { characterAttributesScope, getCharacterAttributes } =
      await import('../../src/characters/attributes.js')

    await expect(getCharacterAttributes(characterId, subjectLifecycleId)).resolves.toMatchObject({
      accruedRemapCooldownDate: '2026-10-01T12:00:00Z',
      bonusRemaps: 2,
      charisma: 19,
      intelligence: 27,
      lastRemapDate: '2025-10-01T12:00:00Z',
      memory: 23,
      perception: 24,
      willpower: 21,
    })
    expect(characterAttributesScope).toBe(scope)
    expect(mocks.getAttributes).toHaveBeenCalledWith({ characterId, subjectLifecycleId })
    expect(mocks.getAttributes).toHaveBeenCalledOnce()
  })

  test('normalizes absent optional remap fields', async () => {
    mocks.getAttributes.mockResolvedValue(
      response({ charisma: 20, intelligence: 20, memory: 20, perception: 20, willpower: 20 }),
    )
    const { getCharacterAttributes } = await import('../../src/characters/attributes.js')

    await expect(getCharacterAttributes(characterId, subjectLifecycleId)).resolves.toMatchObject({
      accruedRemapCooldownDate: null,
      bonusRemaps: 0,
      lastRemapDate: null,
    })
  })

  test('serves a repeated request from the L1 cache without another ESI call', async () => {
    mocks.getAttributes.mockResolvedValue(
      response({ charisma: 20, intelligence: 21, memory: 22, perception: 23, willpower: 24 }),
    )
    const { getCharacterAttributes } = await import('../../src/characters/attributes.js')

    const first = await getCharacterAttributes(characterId, subjectLifecycleId)
    const second = await getCharacterAttributes(characterId, subjectLifecycleId)

    expect(second).toStrictEqual(first)
    expect(mocks.getAttributes).toHaveBeenCalledTimes(2)
  })
})

function response<Data>(data: Data) {
  const value = data as Data & {
    bonus_remaps?: number
    accrued_remap_cooldown_date?: string
    last_remap_date?: string
  }
  return {
    cachedUntil: '',
    data: {
      ...value,
      accruedRemapCooldownDate: value.accrued_remap_cooldown_date ?? null,
      bonusRemaps: value.bonus_remaps ?? 0,
      lastRemapDate: value.last_remap_date ?? null,
    },
    quota: {},
    source: 'esi' as const,
    stale: false,
    validatedAt: '',
  }
}
