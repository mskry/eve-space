import { marketCentsToIsk, marketPriceCents } from './market-isk'

export interface MarketDay {
  readonly date: string
  readonly averageIsk: string
  readonly highIsk: string
  readonly lowIsk: string
  readonly volume: number
  readonly orderCount: number
}

export interface MarketPlottedDay extends MarketDay {
  readonly movingAverage5: string | null
  readonly movingAverage20: string | null
  readonly donchianHigh20: string | null
  readonly donchianLow20: string | null
}

const decimalPrice = /^(?:0|[1-9]\d{0,14})\.\d{2}$/
const dayPattern = /^\d{4}-\d{2}-\d{2}$/
const dayMillis = 86_400_000

const validDay = (day: MarketDay) => {
  if (!dayPattern.test(day.date)) return false
  const date = Date.parse(`${day.date}T00:00:00.000Z`)
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== day.date) return false
  if (![day.averageIsk, day.highIsk, day.lowIsk].every((price) => decimalPrice.test(price)))
    return false
  if (!Number.isSafeInteger(day.volume) || day.volume < 0) return false
  if (!Number.isSafeInteger(day.orderCount) || day.orderCount < 0) return false
  return (
    marketPriceCents(day.lowIsk) <= marketPriceCents(day.averageIsk) &&
    marketPriceCents(day.averageIsk) <= marketPriceCents(day.highIsk)
  )
}

const windowValues = (days: readonly MarketDay[], index: number, length: number) => {
  if (index + 1 < length) return null
  const window = days.slice(index + 1 - length, index + 1)
  for (let position = 1; position < window.length; position += 1) {
    if (Date.parse(window[position]!.date) - Date.parse(window[position - 1]!.date) !== dayMillis) {
      return null
    }
  }
  return window
}

const windowAverage = (window: readonly MarketDay[] | null) =>
  window
    ? marketCentsToIsk(
        window.reduce((sum, entry) => sum + marketPriceCents(entry.averageIsk), 0n) /
          BigInt(window.length),
      )
    : null

export const marketHistorySeries = (records: readonly MarketDay[]): MarketPlottedDay[] => {
  const days = records
    .filter(validDay)
    .toSorted((left, right) => left.date.localeCompare(right.date))
  return days.map((day, index) => {
    const five = windowValues(days, index, 5)
    const twenty = windowValues(days, index, 20)
    const highs = twenty?.map((entry) => marketPriceCents(entry.highIsk))
    const lows = twenty?.map((entry) => marketPriceCents(entry.lowIsk))
    return {
      date: day.date,
      averageIsk: day.averageIsk,
      highIsk: day.highIsk,
      lowIsk: day.lowIsk,
      volume: day.volume,
      orderCount: day.orderCount,
      movingAverage5: windowAverage(five),
      movingAverage20: windowAverage(twenty),
      donchianHigh20: highs
        ? marketCentsToIsk(highs.reduce((max, value) => (value > max ? value : max)))
        : null,
      donchianLow20: lows
        ? marketCentsToIsk(lows.reduce((min, value) => (value < min ? value : min)))
        : null,
    }
  })
}
