import {
  formatCents,
  parsePriceCents,
  type MarketObservationIdentity,
  type MarketOrderRow,
} from './order-depth.js'

const marketDerivationVersion = 1
const depthBandPercents = [1, 5, 10] as const

export interface MarketDerivedMetrics extends MarketObservationIdentity {
  readonly derivationVersion: number
  readonly availableFrom: string
  readonly availableThrough: string
  readonly bestBidIsk: string | null
  readonly bestAskIsk: string | null
  readonly spreadIsk: string | null
  readonly bidVolume: string
  readonly askVolume: string
  readonly depthBands: readonly {
    readonly percent: number
    readonly bidVolume: string
    readonly askVolume: string
  }[]
}

const minimum = (current: bigint | null, value: bigint) =>
  current === null || value < current ? value : current
const maximum = (current: bigint | null, value: bigint) =>
  current === null || value > current ? value : current

export const deriveMarketMetrics = (
  observation: MarketObservationIdentity,
  orders: readonly MarketOrderRow[],
  typeId: number,
): MarketDerivedMetrics => {
  let bestBid: bigint | null = null
  let bestAsk: bigint | null = null
  let bidVolume = 0n
  let askVolume = 0n
  for (const order of orders) {
    if (order.typeId !== typeId) continue
    if (!Number.isSafeInteger(order.volumeRemain) || order.volumeRemain < 0) {
      throw new TypeError('Order remaining volume is invalid')
    }
    const price = parsePriceCents(order.price)
    if (order.side === 'buy') {
      bestBid = maximum(bestBid, price)
      bidVolume += BigInt(order.volumeRemain)
    } else {
      bestAsk = minimum(bestAsk, price)
      askVolume += BigInt(order.volumeRemain)
    }
  }

  const depthBands = depthBandPercents.map((percent) => {
    let bid = 0n
    let ask = 0n
    for (const order of orders) {
      if (order.typeId !== typeId) continue
      const price = parsePriceCents(order.price)
      if (
        order.side === 'buy' &&
        bestBid !== null &&
        price * 100n >= bestBid * BigInt(100 - percent)
      ) {
        bid += BigInt(order.volumeRemain)
      }
      if (
        order.side === 'sell' &&
        bestAsk !== null &&
        price * 100n <= bestAsk * BigInt(100 + percent)
      ) {
        ask += BigInt(order.volumeRemain)
      }
    }
    return { percent, bidVolume: String(bid), askVolume: String(ask) }
  })

  return {
    ...observation,
    derivationVersion: marketDerivationVersion,
    availableFrom: observation.observedAt,
    availableThrough: observation.observedAt,
    bestBidIsk: bestBid === null ? null : formatCents(bestBid),
    bestAskIsk: bestAsk === null ? null : formatCents(bestAsk),
    spreadIsk: bestBid === null || bestAsk === null ? null : formatCents(bestAsk - bestBid),
    bidVolume: String(bidVolume),
    askVolume: String(askVolume),
    depthBands,
  }
}
