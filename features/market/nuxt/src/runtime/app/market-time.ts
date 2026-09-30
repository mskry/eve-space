export const formatMarketTimeUtc = (instant: string) =>
  `${new Date(instant).toISOString().replace('T', ' ').slice(0, 16)} UTC`

export const formatMarketRemaining = (expiryAt: string, now: number) => {
  const seconds = Math.ceil((Date.parse(expiryAt) - now) / 1_000)
  if (!Number.isFinite(seconds)) return 'Expiry unavailable'
  if (seconds <= 0) return 'Expired'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  return `${days}d ${hours}h ${minutes}m`
}

export const marketRemainingMinutes = (expiryAt: string, now: number) =>
  Math.ceil((Date.parse(expiryAt) - now) / 60_000)

export const formatMarketRemainingCompact = (expiryAt: string, now: number) => {
  const minutes = marketRemainingMinutes(expiryAt, now)
  if (!Number.isFinite(minutes)) return '—'
  if (minutes <= 0) return 'Expired'
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  if (days >= 1) return `${days}d ${hours}h`
  return `${hours}h ${minutes % 60}m`
}
