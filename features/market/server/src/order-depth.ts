export interface MarketOrderRow {
  readonly orderId: number
  readonly typeId: number
  readonly locationId: number
  readonly solarSystemId: number | null
  readonly side: 'buy' | 'sell'
  readonly price: string
  readonly volumeRemain: number
  readonly issuedAt: string
  readonly durationDays: number
  readonly minimumVolume: number
  readonly range: string
}

export interface MarketObservationIdentity {
  readonly publication: 'complete'
  readonly observationId: string
  readonly marketId: string
  readonly observedAt: string
  readonly validatedAt: string
  readonly freshUntil: string
}

export interface MarketDepthQuote extends MarketObservationIdentity {
  readonly requestedQuantity: number
  readonly filledQuantity: number
  readonly unfilledQuantity: number
  readonly totalIsk: string
  readonly volumeWeightedPriceIsk: string | null
  readonly bestPriceIsk: string | null
  readonly worstConsumedPriceIsk: string | null
  readonly complete: boolean
}

export const parsePriceCents = (price: string): bigint => {
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/.test(price)) {
    throw new TypeError('Market price must be a nonnegative decimal with at most two places')
  }
  const [whole, fractional = ''] = price.split('.')
  return BigInt(whole!) * 100n + BigInt(fractional.padEnd(2, '0'))
}

export const formatCents = (cents: bigint): string => {
  const sign = cents < 0n ? '-' : ''
  const absolute = cents < 0n ? -cents : cents
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

const compareOrderDepth =
  (side: 'buy' | 'sell') => (left: MarketOrderRow, right: MarketOrderRow) => {
    const leftPrice = parsePriceCents(left.price)
    const rightPrice = parsePriceCents(right.price)
    if (leftPrice !== rightPrice) {
      if (side === 'sell') return leftPrice < rightPrice ? -1 : 1
      return leftPrice > rightPrice ? -1 : 1
    }
    const time = left.issuedAt.localeCompare(right.issuedAt)
    return time || left.orderId - right.orderId
  }

const fillableQuantity = (
  order: MarketOrderRow,
  available: number,
  consumedSide: 'buy' | 'sell',
) => {
  if (!Number.isSafeInteger(order.volumeRemain) || order.volumeRemain < 0) {
    throw new TypeError('Order remaining volume is invalid')
  }
  const fill = Math.min(order.volumeRemain, available)
  if (fill === 0 || (consumedSide === 'buy' && fill < order.minimumVolume)) return 0
  return fill
}

export const quoteMarketDepth = (input: {
  readonly observation: MarketObservationIdentity
  readonly orders: readonly MarketOrderRow[]
  readonly typeId: number
  readonly side: 'buy' | 'sell'
  readonly quantity: number
  readonly locationIds: readonly number[]
}): MarketDepthQuote => {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new TypeError('Quote quantity must be a positive safe integer')
  }
  if (!Number.isSafeInteger(input.typeId) || input.typeId <= 0) {
    throw new TypeError('Quote type must be a positive safe integer')
  }
  const allowedLocations = new Set(input.locationIds)
  const consumedSide = input.side === 'buy' ? 'sell' : 'buy'
  const eligible = input.orders
    .filter(
      (order) =>
        order.typeId === input.typeId &&
        order.side === consumedSide &&
        (allowedLocations.size === 0 || allowedLocations.has(order.locationId)),
    )
    .toSorted(compareOrderDepth(consumedSide))

  let unfilledQuantity = input.quantity
  let totalCents = 0n
  let bestPriceIsk: string | null = null
  let worstConsumedPriceIsk: string | null = null
  for (const order of eligible) {
    if (unfilledQuantity === 0) break
    const fill = fillableQuantity(order, unfilledQuantity, consumedSide)
    if (fill === 0) continue
    const cents = parsePriceCents(order.price)
    totalCents += cents * BigInt(fill)
    unfilledQuantity -= fill
    bestPriceIsk ??= formatCents(cents)
    worstConsumedPriceIsk = formatCents(cents)
  }
  const filledQuantity = input.quantity - unfilledQuantity
  const weightedCents = filledQuantity
    ? (totalCents + BigInt(filledQuantity) / 2n) / BigInt(filledQuantity)
    : null
  return {
    ...input.observation,
    requestedQuantity: input.quantity,
    filledQuantity,
    unfilledQuantity,
    totalIsk: formatCents(totalCents),
    volumeWeightedPriceIsk: weightedCents === null ? null : formatCents(weightedCents),
    bestPriceIsk,
    worstConsumedPriceIsk,
    complete: unfilledQuantity === 0,
  }
}
