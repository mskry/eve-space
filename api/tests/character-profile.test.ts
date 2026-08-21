import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAlliance: vi.fn(),
  getCharacter: vi.fn(),
  getCorporation: vi.fn(),
  listBloodlines: vi.fn(),
  listRaces: vi.fn(),
}))

vi.mock('@evespace/esi-client', () => ({
  EsiClient: class {
    character = { getPublicInfo: mocks.getCharacter }
    corporation = { getPublicInfo: mocks.getCorporation }
    alliance = { getPublicInfo: mocks.getAlliance }
    universe = {
      listBloodlines: mocks.listBloodlines,
      listRaces: mocks.listRaces,
    }
  },
}))

import { getCharacterProfile } from '../src/character-profile.js'

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
  mocks.getCharacter.mockResolvedValue(character)
  mocks.getCorporation.mockResolvedValue({
    member_count: 1,
    name: 'Imperial Academy',
    ticker: 'IAC',
  })
  mocks.listRaces.mockResolvedValue([{ name: 'Amarr', race_id: 4 }])
  mocks.listBloodlines.mockResolvedValue([{ bloodline_id: 5, name: 'Khanid' }])
  mocks.getAlliance.mockResolvedValue(null)
})

describe('character profile', () => {
  test('decodes a legacy Python Unicode literal in the character biography', async () => {
    const profile = await getCharacterProfile(90_000_001)

    expect(profile.bio).toBe('고생 끝에 낙이 온다')
  })

  test('does not interpret Unicode escapes in an ordinary biography', async () => {
    mocks.getCharacter.mockResolvedValueOnce({
      ...character,
      description: String.raw`Fly safe: \uace0`,
    })

    const profile = await getCharacterProfile(90_000_002)

    expect(profile.bio).toBe(String.raw`Fly safe: \uace0`)
  })
})
