import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getAlliance: vi.fn(),
  getCharacter: vi.fn(),
  getCorporation: vi.fn(),
  listBloodlines: vi.fn(),
  listRaces: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/character', () => ({
  createCharacterClient: () => ({ withMetadata: () => ({ getPublicInfo: mocks.getCharacter }) }),
}))
vi.mock('@evespace/esi-client/domains/corporation', () => ({
  createCorporationClient: () => ({
    withMetadata: () => ({ getPublicInfo: mocks.getCorporation }),
  }),
}))
vi.mock('@evespace/esi-client/domains/alliance', () => ({
  createAllianceClient: () => ({ withMetadata: () => ({ getPublicInfo: mocks.getAlliance }) }),
}))
vi.mock('@evespace/esi-client/domains/universe', () => ({
  createUniverseClient: () => ({
    withMetadata: () => ({ listBloodlines: mocks.listBloodlines, listRaces: mocks.listRaces }),
  }),
}))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getPublic: mocks.get }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))

const character = {
  achievement_score: 0,
  birthday: '2008-01-31T00:00:00Z',
  bloodline_id: 5,
  corporation_id: 1_000_166,
  description: String.raw`<font color="#ffffff">u'\uace0\uc0dd \ub05d\uc5d0 \ub099\uc774 \uc628\ub2e4'</font>`,
  gender: 'female',
  name: 'Bandera Primary',
  race_id: 4,
  security_status: -0.3,
}

beforeEach(() => {
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load({})
    return {
      data: loaded.data,
      cachedUntil: '2026-08-20T12:01:00.000Z',
      quota: {},
      source: 'esi',
      stale: false,
    }
  })
  mocks.getCharacter.mockResolvedValue(response(character))
  mocks.getCorporation.mockResolvedValue(
    response({ member_count: 1, name: 'Imperial Academy', ticker: 'IAC' }),
  )
  mocks.listRaces.mockResolvedValue(response([{ name: 'Amarr', race_id: 4 }]))
  mocks.listBloodlines.mockResolvedValue(response([{ bloodline_id: 5, name: 'Khanid' }]))
  mocks.getAlliance.mockResolvedValue(response({ name: 'Alliance', ticker: 'ALLY' }))
})

describe('character profile', () => {
  test('composes independently resilient public resources without changing the DTO', async () => {
    const { getCharacterProfile } = await import('../../src/characters/profile.js')

    await expect(getCharacterProfile(90_000_001)).resolves.toMatchObject({
      id: 90_000_001,
      name: 'Bandera Primary',
      bio: '고생 끝에 낙이 온다',
      corporation: { id: 1_000_166, name: 'Imperial Academy', ticker: 'IAC', memberCount: 1 },
    })
    expect(mocks.get.mock.calls.map(([resource]) => resource.operation)).toEqual([
      'public-character',
      'public-corporation',
      'universe-races',
      'universe-bloodlines',
    ])
  })

  test.each(['profile-first', 'deployment-first'] as const)(
    'shares one mapped corporation representation across consumers with %s ordering',
    async (ordering) => {
      const cache = new Map<string, unknown>()
      mocks.get.mockImplementation(async (resource) => {
        const key = JSON.stringify([resource.operation, resource.inputs])
        if (cache.has(key))
          return { data: cache.get(key), cachedUntil: '', quota: {}, source: 'cache', stale: false }
        const loaded = await resource.load({})
        cache.set(key, loaded.data)
        return { data: loaded.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
      })
      const [{ getCharacterProfile }, { getCorporationPublic }, { resolveDeploymentOrganization }] =
        await Promise.all([
          import('../../src/characters/profile.js'),
          import('../../src/corporations/public-data.js'),
          import('../../src/deployment/organization.js'),
        ])

      const expectProfile = () =>
        expect(getCharacterProfile(90_000_001)).resolves.toMatchObject({
          corporation: { name: 'Imperial Academy', memberCount: 1 },
        })
      const expectDeployment = () =>
        expect(
          resolveDeploymentOrganization('corporation', character.corporation_id),
        ).resolves.toMatchObject({ name: 'Imperial Academy', ticker: 'IAC' })
      if (ordering === 'profile-first') {
        await expectProfile()
        await expectDeployment()
      } else {
        await expectDeployment()
        await expectProfile()
      }
      await expect(getCorporationPublic(character.corporation_id)).resolves.toMatchObject({
        name: 'Imperial Academy',
        memberCount: 1,
      })
      expect(mocks.getCorporation).toHaveBeenCalledOnce()
    },
  )
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
