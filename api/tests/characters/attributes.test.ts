import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createEsiClient: vi.fn(),
  getAttributes: vi.fn(),
  createEsiTransport: vi.fn(),
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

vi.mock('@evespace/esi-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@evespace/esi-client')>()
  return {
    ...original,
    EsiClient: class {
      constructor(options: unknown) {
        mocks.createEsiClient(options)
      }

      callOperation(...arguments_: unknown[]) {
        return mocks.getAttributes(...arguments_)
      }
    },
  }
})
vi.mock('../../src/esi-resilience/request-transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))
vi.mock('../../src/auth/tokens.js', () => ({
  getCharacterAuthorization: mocks.getCharacterAuthorization,
  getCharacterCacheAuthorization: mocks.getCharacterCacheAuthorization,
}))
vi.mock('../../src/esi-resilience/cache-redis.js', () => ({
  getSharedCacheRedisConnection: () => ({
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    del: mocks.cacheDel,
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ getCoordinationConnection: () => ({}) }))
vi.mock('../../src/esi-resilience/coordination.js', () => ({
  acquireEsiRequestLease: mocks.acquire,
  commitEsiFence: mocks.commit,
  getCommittedEsiFence: mocks.getCommitted,
  getEsiRequestLeaseTtl: mocks.getLeaseTtl,
  getEsiResourceRevision: mocks.getRevision,
  incrementEsiResourceRevision: mocks.incrementRevision,
  initializeCacheNamespace: mocks.initialize,
  releaseEsiRequestLease: mocks.release,
  renewEsiRequestLease: mocks.renew,
}))

const characterId = 1404328063
const scope = 'esi-skills.read_skills.v1'
const now = Date.parse('2026-09-01T11:00:00.000Z')
const lease = { key: 'lease', ownerToken: 'owner', fence: 7, ttlMs: 15_000 }
const publicMetadata = {
  cachedUntil: '2026-09-01T11:02:00.000Z',
  validatedAt: '2026-09-01T11:00:00.000Z',
  stale: false,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.resetModules()
  mocks.getAttributes.mockReset()
  mocks.createEsiClient.mockReset()
  mocks.createEsiTransport.mockReset()
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

  mocks.createEsiTransport.mockReturnValue(vi.fn())
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

    await expect(getCharacterAttributes(characterId)).resolves.toEqual({
      charisma: 19,
      intelligence: 27,
      memory: 23,
      perception: 24,
      willpower: 21,
      bonusRemaps: 2,
      accruedRemapCooldownDate: '2026-10-01T12:00:00Z',
      lastRemapDate: '2025-10-01T12:00:00Z',
      ...publicMetadata,
    })
    expect(characterAttributesScope).toBe(scope)
    expect(mocks.getCharacterCacheAuthorization).toHaveBeenCalledWith(characterId, scope)
    expect(mocks.getCharacterAuthorization).toHaveBeenCalledWith(characterId, scope)
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('attributes', `character-${characterId}`)
    expect(mocks.createEsiClient).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      token: 'access-token',
      validateResponses: true,
    })
    expect(mocks.getAttributes).toHaveBeenCalledWith('GetCharactersCharacterIdAttributes', {
      path: { character_id: characterId },
    })
    expect(mocks.getAttributes).toHaveBeenCalledOnce()
  })

  test('normalizes absent optional remap fields', async () => {
    mocks.getAttributes.mockResolvedValue(
      response({ charisma: 20, intelligence: 20, memory: 20, perception: 20, willpower: 20 }),
    )
    const { getCharacterAttributes } = await import('../../src/characters/attributes.js')

    await expect(getCharacterAttributes(characterId)).resolves.toMatchObject({
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

    const first = await getCharacterAttributes(characterId)
    const second = await getCharacterAttributes(characterId)

    expect(second).toEqual(first)
    expect(mocks.getAttributes).toHaveBeenCalledOnce()
    expect(mocks.getCharacterAuthorization).toHaveBeenCalledOnce()
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
