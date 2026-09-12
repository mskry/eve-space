import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  createEsiClient: vi.fn(),
  getAttributes: vi.fn(),
  getCharacterAuthorization: vi.fn(),
  getCharacterCacheAuthorization: vi.fn(),
  acquire: vi.fn(),
  commit: vi.fn(),
  getCommitted: vi.fn(),
  getLeaseTtl: vi.fn(),
  getRevision: vi.fn(),
  incrementRevision: vi.fn(),
  initialize: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
}))

vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorizationForLifecycle: mocks.getCharacterAuthorization,
  getCharacterCacheAuthorizationForLifecycle: mocks.getCharacterCacheAuthorization,
}))
vi.mock('../../src/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    del: mocks.cacheDel,
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
  observeCacheRedisConnectionErrors: vi.fn(),
}))
vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock((_definition, input) => mocks.getAttributes(input)),
)

const characterId = 1404328063
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const scope = 'esi-skills.read_skills.v1'
const now = Date.parse('2026-09-01T11:00:00.000Z')
const lease = { key: 'lease', ownerToken: 'owner', fence: 7, ttlMs: 15_000 }

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
        charisma: 19,
        intelligence: 27,
        memory: 23,
        perception: 24,
        willpower: 21,
        bonus_remaps: 2,
        accrued_remap_cooldown_date: '2026-10-01T12:00:00Z',
        last_remap_date: '2025-10-01T12:00:00Z',
      }),
    )
    const { characterAttributesScope, getCharacterAttributes } =
      await import('../../src/characters/attributes.js')

    await expect(getCharacterAttributes(characterId, subjectLifecycleId)).resolves.toMatchObject({
      charisma: 19,
      intelligence: 27,
      memory: 23,
      perception: 24,
      willpower: 21,
      bonusRemaps: 2,
      accruedRemapCooldownDate: '2026-10-01T12:00:00Z',
      lastRemapDate: '2025-10-01T12:00:00Z',
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
      bonusRemaps: 0,
      accruedRemapCooldownDate: null,
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

    expect(second).toEqual(first)
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
    data: {
      ...value,
      bonusRemaps: value.bonus_remaps ?? 0,
      accruedRemapCooldownDate: value.accrued_remap_cooldown_date ?? null,
      lastRemapDate: value.last_remap_date ?? null,
    },
    cachedUntil: '',
    validatedAt: '',
    quota: {},
    source: 'esi' as const,
    stale: false,
  }
}
