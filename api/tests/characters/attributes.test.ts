import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSkillsClient: vi.fn(),
  createEsiTransport: vi.fn(),
  get: vi.fn(),
  getAttributes: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/skills', () => ({
  createSkillsClient: mocks.createSkillsClient,
}))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.get }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))

const characterId = 1404328063
const revalidation = { ifNoneMatch: 'etag', ifModifiedSince: 'date' }
const esiMetadata = {
  cachedUntil: '2026-09-01T11:01:00.000Z',
  validatedAt: '2026-09-01T11:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}
const publicMetadata = {
  cachedUntil: esiMetadata.cachedUntil,
  validatedAt: esiMetadata.validatedAt,
  stale: false,
}

beforeEach(() => {
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load(
      { accessToken: 'access-token', principal: `character-${characterId}` },
      revalidation,
    )
    return { data: loaded.data, ...esiMetadata }
  })
  mocks.createSkillsClient.mockReturnValue({
    withMetadata: () => ({ getAttributes: mocks.getAttributes }),
  })
})

describe('character attributes', () => {
  test('loads and maps attributes through the registered private resource', async () => {
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
    expect(characterAttributesScope).toBe('esi-skills.read_skills.v1')
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'attributes',
      inputs: { characterId },
    })
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('attributes', `character-${characterId}`)
    expect(mocks.getAttributes).toHaveBeenCalledWith(characterId, revalidation)
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

  test('returns a cached application DTO without calling ESI', async () => {
    const cached = {
      charisma: 20,
      intelligence: 21,
      memory: 22,
      perception: 23,
      willpower: 24,
      bonusRemaps: 1,
      accruedRemapCooldownDate: null,
      lastRemapDate: null,
    }
    mocks.get.mockResolvedValueOnce({
      data: cached,
      cachedUntil: '',
      validatedAt: '2026-09-01T11:00:00.000Z',
      quota: {},
      source: 'cache',
      stale: false,
    })
    const { getCharacterAttributes } = await import('../../src/characters/attributes.js')

    await expect(getCharacterAttributes(characterId)).resolves.toEqual({
      ...cached,
      cachedUntil: '',
      validatedAt: '2026-09-01T11:00:00.000Z',
      stale: false,
    })
    expect(mocks.getAttributes).not.toHaveBeenCalled()
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
