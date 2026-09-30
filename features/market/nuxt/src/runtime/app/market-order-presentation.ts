import { marketPriceCents } from './market-isk'
export { formatMarketIsk } from './market-isk'

export interface MarketOrderPresentation {
  readonly orderId: number
  readonly side: 'buy' | 'sell'
  readonly price: string
  readonly volumeRemain: number
  readonly locationId: number
  readonly locationName: string | null
  readonly issuedAt: string
  readonly expiryAt: string
  readonly range: string
  readonly minimumVolume: number
}

export type MarketOrderSort = 'price' | 'volume' | 'location' | 'expiry' | 'range' | 'minimum'

export const formatMarketOrderRange = (range: string) => {
  if (range === 'station') return 'Station'
  if (range === 'region') return 'Region'
  if (range === 'solarsystem') return 'Solar system'
  const jumps = Number(range)
  return Number.isSafeInteger(jumps) && jumps >= 0 ? `${jumps} jumps` : range
}

const compareMarketOrderField = (
  left: MarketOrderPresentation,
  right: MarketOrderPresentation,
  field: MarketOrderSort,
) => {
  switch (field) {
    case 'price': {
      const difference = marketPriceCents(left.price) - marketPriceCents(right.price)
      if (difference < 0n) return -1
      if (difference > 0n) return 1
      return 0
    }
    case 'volume':
      return left.volumeRemain - right.volumeRemain
    case 'location':
      return (left.locationName ?? String(left.locationId)).localeCompare(
        right.locationName ?? String(right.locationId),
      )
    case 'expiry':
      return left.expiryAt.localeCompare(right.expiryAt)
    case 'range':
      return left.range.localeCompare(right.range)
    case 'minimum':
      return left.minimumVolume - right.minimumVolume
  }
}

export const sortMarketOrders = <Order extends MarketOrderPresentation>(
  rows: readonly Order[],
  side: 'buy' | 'sell',
  field: MarketOrderSort = 'price',
  direction: 'asc' | 'desc' = side === 'sell' ? 'asc' : 'desc',
): Order[] =>
  rows.toSorted((left, right) => {
    const compared = compareMarketOrderField(left, right, field)
    if (compared !== 0) return direction === 'asc' ? compared : -compared
    return left.issuedAt.localeCompare(right.issuedAt) || left.orderId - right.orderId
  })

export const formatMarketPriceDelta = (price: string, best: string) => {
  const bestCents = marketPriceCents(best)
  if (bestCents === 0n) return ''
  const basisPoints = Number(((marketPriceCents(price) - bestCents) * 10_000n) / bestCents)
  if (basisPoints === 0) return '±0.00%'
  const sign = basisPoints > 0 ? '+' : '−'
  return `${sign}${(Math.abs(basisPoints) / 100).toFixed(2)}%`
}

export const marketBuyOrderTags = (
  order: Pick<MarketOrderPresentation, 'range' | 'minimumVolume'>,
) => {
  const tags: string[] = []
  if (order.range !== 'region') tags.push(formatMarketOrderRange(order.range))
  if (order.minimumVolume > 1) tags.push(`Min ${order.minimumVolume.toLocaleString('en-US')}`)
  return tags
}

const lowballBuyShareOfBest = 50n

export const isMarketLowballBuy = (price: string, bestBuy: string) =>
  marketPriceCents(price) * 100n <= marketPriceCents(bestBuy) * lowballBuyShareOfBest
