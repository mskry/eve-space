import type { MarketHistoryReads, MarketProfileReads } from './persistence.js'
import { marketSourceStatus } from './book-reads.js'
import { MarketReadError } from './read-input.js'

const historyFreshness = (
  history: NonNullable<Awaited<ReturnType<MarketHistoryReads['readMarketHistorySource']>>>,
) => {
  if (history.status === 'uncollected') return 'uncollected' as const
  if (!history.freshUntil || history.retainedEvidence) return 'stale' as const
  return marketSourceStatus(history.freshUntil)
}

export const readMarketHistory = async (
  persistence: MarketHistoryReads,
  profileId: string,
  typeId: number,
) => {
  const history = await persistence.readMarketHistorySource({ profileId, typeId })
  if (!history) return null
  const freshness = historyFreshness(history)
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
    source: null,
    retainedEvidence: false,
  }
  return { ...source, profileId, profileRevision: profile.revision }
}
