import type { MarketHistoryReads, MarketProfileReads } from './persistence.js'
import { marketSourceStatus } from './book-reads.js'
import { MarketReadError } from './read-input.js'

export const readMarketHistory = async (
  persistence: MarketHistoryReads,
  profileId: string,
  typeId: number,
) => {
  const history = await persistence.readMarketHistory({ profileId, typeId })
  if (!history) return null
  const freshness =
    history.status === 'uncollected' || !history.freshUntil
      ? ('uncollected' as const)
      : marketSourceStatus(history.freshUntil)
  return { ...history, freshness }
}

export const readEnabledMarketHistory = async (
  persistence: MarketHistoryReads & MarketProfileReads,
  profileId: string,
  typeId: number,
) => {
  const profiles = await persistence.listMarketProfiles({ enabledOnly: true })
  const profile = profiles.find((entry) => entry.profileId === profileId)
  if (!profile || (profile.mode === 'watched-types' && !profile.watchedTypeIds.includes(typeId)))
    return null
  const history = await readMarketHistory(persistence, profileId, typeId)
  const current = (await persistence.listMarketProfiles({ enabledOnly: true })).find(
    (entry) => entry.profileId === profileId,
  )
  if (!current || current.revision !== profile.revision)
    throw new MarketReadError('MARKET_HISTORY_PROFILE_CHANGED', 409)
  const source = history ?? {
    status: 'uncollected' as const,
    freshness: 'uncollected' as const,
    regionId: profile.regionId,
    typeId,
    validatedAt: null,
    freshUntil: null,
    days: [],
  }
  return { ...source, profileId, profileRevision: profile.revision }
}
