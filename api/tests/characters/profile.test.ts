import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({ executeRepresentation: vi.fn() }))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

const freshness = {
  cachedUntil: '2026-08-20T12:01:00.000Z',
  validatedAt: '2026-08-20T12:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) => {
    switch (definition.operation) {
      case 'public-character':
        return Promise.resolve(
          result({
            name: 'Bandera Primary',
            birthday: '2008-01-31T00:00:00Z',
            gender: 'female',
            raceId: 4,
            bloodlineId: 5,
            securityStatus: -0.3,
            achievementScore: 0,
            corporationId: 1_000_166,
            factionId: null,
            allianceId: 99_000_001,
            description: String.raw`<font color="#ffffff">u'고생 끝에 낙이 온다'</font>`,
          }),
        )
      case 'public-corporation':
        return Promise.resolve(
          result({
            found: true,
            corporation: { name: 'Imperial Academy', ticker: 'IAC', memberCount: 1 },
          }),
        )
      case 'universe-races':
        return Promise.resolve(result([{ raceId: 4, name: 'Amarr' }]))
      case 'universe-bloodlines':
        return Promise.resolve(result([{ bloodlineId: 5, name: 'Khanid' }]))
      case 'public-alliance':
        return Promise.resolve(result({ name: 'Alliance', ticker: 'ALLY' }))
      default:
        throw new Error(`Unexpected callable ${definition.operation}`)
    }
  })
})

describe('character profile', () => {
  test('composes mapped public callable results into the profile DTO', async () => {
    const { getCharacterProfile } = await import('../../src/characters/profile.js')

    await expect(getCharacterProfile(90_000_001)).resolves.toMatchObject({
      id: 90_000_001,
      name: 'Bandera Primary',
      bio: '고생 끝에 낙이 온다',
      race: 'Amarr',
      bloodline: 'Khanid',
      corporation: { id: 1_000_166, name: 'Imperial Academy', ticker: 'IAC', memberCount: 1 },
      alliance: { id: 99_000_001, name: 'Alliance', ticker: 'ALLY' },
    })
    expect(
      mocks.executeRepresentation.mock.calls.map(([definition]) => definition.operation),
    ).toEqual([
      'public-character',
      'public-corporation',
      'universe-races',
      'universe-bloodlines',
      'public-alliance',
    ])
  })

  test('uses the oldest mapped validation time and stale failure class', async () => {
    mocks.executeRepresentation.mockImplementation((definition) => {
      const base = freshnessFor(
        definition.operation === 'public-alliance'
          ? '2026-08-20T11:56:00.000Z'
          : '2026-08-20T12:00:00.000Z',
      )
      if (definition.operation === 'universe-bloodlines')
        return Promise.resolve({
          ...result([{ bloodlineId: 5, name: 'Khanid' }]),
          ...base,
          stale: true,
          refreshFailureClass: 'response-invalid',
        })
      const defaults = {
        'public-character': {
          name: 'Bandera Primary',
          birthday: '',
          gender: 'female',
          raceId: 4,
          bloodlineId: 5,
          securityStatus: 0,
          achievementScore: 0,
          corporationId: 1_000_166,
          factionId: null,
          allianceId: 99_000_001,
        },
        'public-corporation': {
          found: true,
          corporation: { name: 'Imperial Academy', ticker: 'IAC', memberCount: 1 },
        },
        'universe-races': [{ raceId: 4, name: 'Amarr' }],
        'public-alliance': { name: 'Alliance', ticker: 'ALLY' },
      } as const
      return Promise.resolve({
        data: defaults[definition.operation as keyof typeof defaults],
        ...base,
      })
    })
    const { getCharacterProfile } = await import('../../src/characters/profile.js')

    await expect(getCharacterProfile(90_000_001)).resolves.toMatchObject({
      validatedAt: '2026-08-20T11:56:00.000Z',
      stale: true,
      refreshFailureClass: 'response-invalid',
    })
  })
})

function result<Data>(data: Data) {
  return { data, ...freshness }
}

function freshnessFor(validatedAt: string) {
  return { ...freshness, validatedAt }
}
