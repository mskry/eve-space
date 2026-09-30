import { expect, test } from 'vitest'
import {
  eligibleMarketProfiles,
  selectMarketProfile,
} from '../src/runtime/app/market-profile-selection'

const profiles = [
  { profileId: 'forge', marketScope: 'region' as const, watchedTypeIds: [] },
  { profileId: 'global-plex', marketScope: 'global-plex' as const, watchedTypeIds: [44992] },
]

test('restricts PLEX to its global market even when a regional profile is requested', () => {
  const plex = eligibleMarketProfiles(profiles, 44992)
  expect(plex.map(({ profileId }) => profileId)).toEqual(['global-plex'])
  expect(selectMarketProfile(plex, '')?.profileId).toBe('global-plex')
  expect(selectMarketProfile(plex, 'forge')?.profileId).toBe('global-plex')
  expect(selectMarketProfile(eligibleMarketProfiles([profiles[0]!], 44992), 'forge')).toBeNull()
})

test('excludes the PLEX-only profile when another item is selected', () => {
  const other = eligibleMarketProfiles(profiles, 34)
  expect(other.map(({ profileId }) => profileId)).toEqual(['forge'])
  expect(selectMarketProfile(other, 'global-plex')?.profileId).toBe('forge')
})
