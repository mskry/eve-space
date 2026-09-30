import type { MarketPlottedDay } from './market-history-presentation'

export interface MarketHistoryRange {
  start: number
  end: number
}

export interface MarketPriceBounds {
  min: number
  max: number
}

export interface MarketHistoryLayout {
  width: number
  height: number
  left: number
  right: number
  top: number
  priceBottom: number
  volumeTop: number
  volumeBottom: number
  startTime: number
  endTime: number
  price: MarketPriceBounds
}

export const marketDayTime = (date: string) => Date.parse(`${date}T00:00:00Z`)
const minimumHistorySpan = (length: number) => Math.min(23, Math.max(1, length - 1))

export const initialHistoryRange = (length: number, width: number): MarketHistoryRange => {
  const end = Math.max(0, length - 1)
  const span = Math.max(minimumHistorySpan(length), Math.min(80, Math.ceil(width / 10)))
  return { start: Math.max(0, end - span), end }
}

export const resizeHistoryRange = (
  range: MarketHistoryRange,
  side: 'start' | 'end',
  target: number,
  length: number,
): MarketHistoryRange => {
  const span = minimumHistorySpan(length)
  const end = length - 1
  if (side === 'start') {
    return { start: Math.max(0, Math.min(range.end - span, Math.round(target))), end: range.end }
  }
  return {
    start: range.start,
    end: Math.min(end, Math.max(range.start + span, Math.round(target))),
  }
}

export const moveHistoryRange = (
  range: MarketHistoryRange,
  delta: number,
  length: number,
): MarketHistoryRange => {
  const offset = Math.max(-range.start, Math.min(length - 1 - range.end, Math.round(delta)))
  return { start: range.start + offset, end: range.end + offset }
}

export const fitMarketPrice = (
  days: readonly MarketPlottedDay[],
  range: MarketHistoryRange,
): MarketPriceBounds => {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = 0
  for (let index = range.start; index <= range.end; index += 1) {
    const day = days[index]!
    minimum = Math.min(minimum, Number(day.lowIsk), Number(day.donchianLow20 ?? day.lowIsk))
    maximum = Math.max(maximum, Number(day.highIsk), Number(day.donchianHigh20 ?? day.highIsk))
  }
  if (!Number.isFinite(minimum)) return { min: 0, max: 1 }
  const padding = Math.max((maximum - minimum) * 0.08, maximum * 0.005, 0.01)
  return { min: Math.max(0, minimum - padding), max: maximum + padding }
}

export const zoomMarketPrice = (
  bounds: MarketPriceBounds,
  factor: number,
  position: number,
): MarketPriceBounds => {
  const span = bounds.max - bounds.min
  const nextSpan = Math.max(0.01, Math.min(span * factor, 1_000_000_000_000_000))
  const anchor = bounds.max - Math.max(0, Math.min(1, position)) * span
  const min = Math.max(0, anchor - (anchor - bounds.min) * (nextSpan / span))
  return { min, max: min + nextSpan }
}

export const panMarketPrice = (bounds: MarketPriceBounds, fraction: number): MarketPriceBounds => {
  const delta = fraction * (bounds.max - bounds.min)
  const min = Math.max(0, bounds.min + delta)
  return { min, max: min + bounds.max - bounds.min }
}

export const marketHistoryLayout = (
  days: readonly MarketPlottedDay[],
  range: MarketHistoryRange,
  price: MarketPriceBounds,
  width: number,
  height: number,
): MarketHistoryLayout => ({
  width,
  height,
  left: width < 500 ? 55 : 68,
  right: width - 16,
  top: 27,
  priceBottom: height - 115,
  volumeTop: height - 103,
  volumeBottom: height - 12,
  startTime: marketDayTime(days[range.start]!.date),
  endTime: marketDayTime(days[range.end]!.date),
  price,
})

export const marketHistoryX = (date: string, layout: MarketHistoryLayout) =>
  layout.left +
  ((marketDayTime(date) - layout.startTime) / Math.max(1, layout.endTime - layout.startTime)) *
    (layout.right - layout.left)

export const marketHistoryY = (price: number, layout: MarketHistoryLayout) =>
  layout.priceBottom -
  ((price - layout.price.min) / (layout.price.max - layout.price.min)) *
    (layout.priceBottom - layout.top)

export const closestMarketDay = (days: readonly MarketPlottedDay[], time: number) => {
  let low = 0
  let high = days.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (marketDayTime(days[middle]!.date) < time) low = middle + 1
    else high = middle
  }
  if (low === 0) return 0
  return Math.abs(marketDayTime(days[low]!.date) - time) <
    Math.abs(marketDayTime(days[low - 1]!.date) - time)
    ? low
    : low - 1
}
