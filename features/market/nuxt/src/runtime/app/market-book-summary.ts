import { formatMarketIskAmount, marketCentsToIsk, marketPriceCents } from './market-isk'
import { sortMarketOrders, type MarketOrderPresentation } from './market-order-presentation'

interface MarketBookSide {
  readonly rows: readonly MarketOrderPresentation[]
  readonly hasMore: boolean
}

export interface MarketBookSummary {
  bestSell: string | null
  bestBuy: string | null
  spread: string | null
  spreadShare: string | null
  sellUnits: string
  buyUnits: string
}

const formatCents = (cents: bigint) => {
  const amount = formatMarketIskAmount(marketCentsToIsk(cents < 0n ? -cents : cents))
  return cents < 0n ? `−${amount}` : amount
}

const listedUnits = (side: MarketBookSide) => {
  const units = side.rows.reduce((sum, row) => sum + row.volumeRemain, 0).toLocaleString('en-US')
  return side.hasMore ? `${units}+` : units
}

export const marketBookSummary = (
  sellers: MarketBookSide,
  buyers: MarketBookSide,
): MarketBookSummary => {
  const bestSell = sortMarketOrders(sellers.rows, 'sell')[0]?.price ?? null
  const bestBuy = sortMarketOrders(buyers.rows, 'buy')[0]?.price ?? null
  const summary: MarketBookSummary = {
    bestSell: bestSell && formatMarketIskAmount(bestSell),
    bestBuy: bestBuy && formatMarketIskAmount(bestBuy),
    spread: null,
    spreadShare: null,
    sellUnits: listedUnits(sellers),
    buyUnits: listedUnits(buyers),
  }
  if (!bestSell || !bestBuy) return summary
  const sellCents = marketPriceCents(bestSell)
  const spreadCents = sellCents - marketPriceCents(bestBuy)
  summary.spread = formatCents(spreadCents)
  if (sellCents > 0n) {
    const share = Number((spreadCents * 10_000n) / sellCents) / 100
    summary.spreadShare = `${share < 0 ? '−' : ''}${Math.abs(share).toFixed(2)}% of sell`
  }
  return summary
}
