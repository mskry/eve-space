import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({ executeRepresentation: vi.fn() }))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

const freshness = {
  cachedUntil: '2026-08-20T12:01:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
  validatedAt: '2026-08-20T12:00:00.000Z',
}

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) => {
    switch (definition.operation) {
      case 'public-character':
        return Promise.resolve(
          result({
            achievementScore: 0,
            allianceId: 99_000_001,
            birthday: '2008-01-31T00:00:00Z',
            bloodlineId: 5,
            corporationId: 1_000_166,
            description: String.raw`<font color="#ffffffff">u'고생 끝에 낙이 온다'</font>`,
            factionId: null,
            gender: 'female',
            name: 'Bandera Primary',
            raceId: 4,
            securityStatus: -0.3,
          }),
        )
      case 'public-corporation':
        return Promise.resolve(
          result({
            corporation: { memberCount: 1, name: 'Imperial Academy', ticker: 'IAC' },
            found: true,
          }),
        )
      case 'universe-races':
        return Promise.resolve(result([{ name: 'Amarr', raceId: 4 }]))
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
      alliance: { id: 99_000_001, name: 'Alliance', ticker: 'ALLY' },
      bio: {
        plainText: '고생 끝에 낙이 온다',
        runs: [{ color: '#ffffffff', start: 0, text: '고생 끝에 낙이 온다' }],
      },
      bloodline: 'Khanid',
      corporation: { id: 1_000_166, memberCount: 1, name: 'Imperial Academy', ticker: 'IAC' },
      id: 90_000_001,
      name: 'Bandera Primary',
      race: 'Amarr',
    })
    expect(
      mocks.executeRepresentation.mock.calls.map(([definition]) => definition.operation),
    ).toStrictEqual([
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
      if (definition.operation === 'universe-bloodlines') {
        return Promise.resolve({
          ...result([{ bloodlineId: 5, name: 'Khanid' }]),
          ...base,
          refreshFailureClass: 'response-invalid',
          retryAt: '2026-08-20T12:05:00.000Z',
          stale: true,
        })
      }
      const defaults = {
        'public-alliance': { name: 'Alliance', ticker: 'ALLY' },
        'public-character': {
          achievementScore: 0,
          allianceId: 99_000_001,
          birthday: '',
          bloodlineId: 5,
          corporationId: 1_000_166,
          factionId: null,
          gender: 'female',
          name: 'Bandera Primary',
          raceId: 4,
          securityStatus: 0,
        },
        'public-corporation': {
          corporation: { memberCount: 1, name: 'Imperial Academy', ticker: 'IAC' },
          found: true,
        },
        'universe-races': [{ raceId: 4, name: 'Amarr' }],
      } as const
      return Promise.resolve({
        data: defaults[definition.operation as keyof typeof defaults],
        ...base,
      })
    })
    const { getCharacterProfile } = await import('../../src/characters/profile.js')

    await expect(getCharacterProfile(90_000_001)).resolves.toMatchObject({
      refreshFailureClass: 'response-invalid',
      retryAt: '2026-08-20T12:05:00.000Z',
      stale: true,
      validatedAt: '2026-08-20T11:56:00.000Z',
    })
  })
})

function result<Data>(data: Data) {
  return { data, ...freshness }
}

function freshnessFor(validatedAt: string) {
  return { ...freshness, validatedAt }
}
