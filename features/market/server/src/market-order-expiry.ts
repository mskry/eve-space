import { marketCollectionBounds } from './market-bounds.js'

export const marketOrderExpiryAt = (issuedAt: string, durationDays: number) => {
  const issued = Date.parse(issuedAt)
  if (
    !Number.isFinite(issued) ||
    !Number.isSafeInteger(durationDays) ||
    durationDays < 0 ||
    durationDays > marketCollectionBounds.maximumOrderDurationDays
  ) {
    throw new TypeError('Market order expiry source is invalid')
  }
  return new Date(issued + durationDays * 86_400_000).toISOString()
}
