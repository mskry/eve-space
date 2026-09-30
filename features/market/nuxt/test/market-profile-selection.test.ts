import { expect, test } from 'vitest'
import {
  eligibleMarketProfiles,
  selectMarketProfile,
} from '../src/runtime/app/market-profile-selection'

const profiles = [
  { profileId: 'forge', marketScope: 'region' as const, watchedTypeIds: [] },
  { profileId: 'global-plex', marketScope: 'global-plex' as const, watchedTypeIds: [44992] },
]

test('defaults PLEX to the actual global market but preserves an explicit regional choice', () => {
  const plex = eligibleMarketProfiles(profiles, 44992)
  expect(plex.map(({ profileId }) => profileId)).toEqual(['forge', 'global-plex'])
  expect(selectMarketProfile(plex, '')?.profileId).toBe('global-plex')
  expect(selectMarketProfile(plex, 'forge')?.profileId).toBe('forge')
})

test('excludes the PLEX-only profile when another item is selected', () => {
  const other = eligibleMarketProfiles(profiles, 34)
  expect(other.map(({ profileId }) => profileId)).toEqual(['forge'])
  expect(selectMarketProfile(other, 'global-plex')?.profileId).toBe('forge')
})
