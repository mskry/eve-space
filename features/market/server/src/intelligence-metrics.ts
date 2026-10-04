import {
  intelligenceDecimal,
  intelligenceDifferencePercent,
  intelligenceRatio,
  type IntelligenceFraction,
} from './intelligence-arithmetic.js'
import type {
  IntelligenceCoverage,
  IntelligenceWindowInput,
  IntelligenceWindowDays,
  IntelligenceNullReason,
  IntelligenceMetricInput,
  IntelligenceMetric,
  IntelligenceMetrics,
} from './intelligence-representation.js'
import { parsePriceCents } from './order-depth.js'

export const marketIntelligenceFormulaVersion = 1
const metric = (
  fraction: IntelligenceFraction | null,
  nullReason: IntelligenceNullReason | null,
  window?: IntelligenceCoverage,
): IntelligenceMetric => ({
  value: fraction ? intelligenceDecimal(fraction) : null,
  numerator: fraction ? String(fraction.numerator) : null,
  denominator: fraction ? String(fraction.denominator) : null,
  nullReason,
  observedDays: window?.observedDays ?? null,
  windowDays: window?.windowDays ?? null,
  complete: window ? window.observedDays === window.windowDays : null,
})

const sourceWindowReason = (input: IntelligenceMetricInput, window: IntelligenceWindowInput) => {
  if (input.sourceState !== 'supplied') return 'SOURCE_UNAVAILABLE' as const
  if (!window.observedDays) return 'NO_OBSERVATIONS' as const
  return null
}

const windowMetric = (
  input: IntelligenceMetricInput,
  window: IntelligenceWindowInput,
  numerator: bigint,
  denominator: bigint,
) => {
  const reason = sourceWindowReason(input, window)
  if (reason) return metric(null, reason, window)
  if (denominator <= 0n) return metric(null, 'ZERO_DENOMINATOR', window)
  return metric({ numerator, denominator }, null, window)
}

const baselineMetric = (input: IntelligenceMetricInput, window: IntelligenceWindowInput) =>
  windowMetric(input, window, BigInt(window.estimatedValueCents), BigInt(window.volume) * 100n)

const baselineFraction = (window: IntelligenceWindowInput): IntelligenceFraction => ({
  numerator: BigInt(window.estimatedValueCents),
  denominator: BigInt(window.volume) * 100n,
})

const priceComparison = (
  input: IntelligenceMetricInput,
  window: IntelligenceWindowInput,
  price: string | null,
  missingReason: IntelligenceNullReason,
) => {
  const baseline = baselineMetric(input, window)
  if (baseline.nullReason) return baseline
  if (price === null) return metric(null, missingReason, window)
  const reference = baselineFraction(window)
  if (reference.numerator === 0n) return metric(null, 'ZERO_DENOMINATOR', window)
  return metric(
    intelligenceDifferencePercent(
      { numerator: parsePriceCents(price), denominator: 100n },
      reference,
    ),
    null,
    window,
  )
}

const meanVolume = (window: IntelligenceWindowInput): IntelligenceFraction => ({
  numerator: BigInt(window.volume),
  denominator: BigInt(window.observedDays),
})

const volumeComparison = (
  input: IntelligenceMetricInput,
  year: IntelligenceWindowInput,
  value: IntelligenceFraction | null,
  coverage: IntelligenceWindowInput,
) => {
  const reason = sourceWindowReason(input, year) ?? sourceWindowReason(input, coverage)
  if (reason) return metric(null, reason, year)
  if (value === null) return metric(null, 'NO_ANCHOR', year)
  if (BigInt(year.volume) === 0n) return metric(null, 'ZERO_DENOMINATOR', year)
  return metric(intelligenceRatio(value, meanVolume(year)), null, year)
}

const supplyMetric = (
  input: IntelligenceMetricInput,
  week: IntelligenceWindowInput,
  quantity: string | null,
) => {
  const reason = sourceWindowReason(input, week)
  if (reason) return metric(null, reason, week)
  if (!input.book) return metric(null, 'NO_BOOK', week)
  if (quantity === null) return metric(null, 'NO_ASK', week)
  return windowMetric(
    input,
    week,
    BigInt(quantity) * BigInt(week.observedDays),
    BigInt(week.volume),
  )
}

const bookQuantity = (input: IntelligenceMetricInput, quantity: string | null) => {
  if (!input.book) return metric(null, 'NO_BOOK')
  if (quantity === null) return metric(null, 'NO_ASK')
  return metric({ numerator: BigInt(quantity), denominator: 1n }, null)
}

const bookPrice = (input: IntelligenceMetricInput, side: 'bid' | 'ask') => {
  if (!input.book) return metric(null, 'NO_BOOK')
  const price = side === 'bid' ? input.book.bestBidIsk : input.book.bestAskIsk
  if (price === null) return metric(null, side === 'bid' ? 'NO_BID' : 'NO_ASK')
  return metric({ numerator: parsePriceCents(price), denominator: 100n }, null)
}

const bookSpread = (input: IntelligenceMetricInput, percent: boolean) => {
  const bid = bookPrice(input, 'bid')
  const ask = bookPrice(input, 'ask')
  if (bid.nullReason) return bid
  if (ask.nullReason) return ask
  const bestBid = parsePriceCents(input.book!.bestBidIsk!)
  const bestAsk = parsePriceCents(input.book!.bestAskIsk!)
  if (percent && bestAsk === 0n) return metric(null, 'ZERO_DENOMINATOR')
  const numerator = (bestAsk - bestBid) * (percent ? 100n : 1n)
  return metric({ numerator, denominator: percent ? bestAsk : 100n }, null)
}

const checkedWindow = (input: IntelligenceMetricInput, days: IntelligenceWindowDays) => {
  const window = input.windows.find((entry) => entry.windowDays === days)
  if (
    !window ||
    !Number.isInteger(window.observedDays) ||
    window.observedDays < 0 ||
    window.observedDays > days
  )
    throw new RangeError('Invalid intelligence window coverage')
  if (
    [window.volume, window.orderCount, window.estimatedValueCents].some(
      (value) => !/^(?:0|[1-9]\d{0,79})$/.test(value),
    )
  )
    throw new RangeError('Invalid intelligence window aggregate')
  return window
}

const anchorTradedValueMetric = (input: IntelligenceMetricInput) => {
  const coverage = { windowDays: 1, observedDays: input.anchor ? 1 : 0 }
  if (input.sourceState !== 'supplied') return metric(null, 'SOURCE_UNAVAILABLE', coverage)
  if (!input.anchor) return metric(null, 'NO_ANCHOR', coverage)
  return metric(
    {
      numerator: parsePriceCents(input.anchor.averageIsk) * BigInt(input.anchor.volume),
      denominator: 100n,
    },
    null,
    coverage,
  )
}

export const deriveMarketIntelligenceMetrics = (
  input: IntelligenceMetricInput,
): IntelligenceMetrics => {
  const week = checkedWindow(input, 7)
  const month = checkedWindow(input, 30)
  const year = checkedWindow(input, 365)
  const anchorVolume = input.anchor
    ? { numerator: BigInt(input.anchor.volume), denominator: 1n }
    : null
  return {
    baselineWeekIsk: baselineMetric(input, week),
    baselineMonthIsk: baselineMetric(input, month),
    baselineYearIsk: baselineMetric(input, year),
    weekPriceChangePercent: priceComparison(
      input,
      week,
      input.anchor?.averageIsk ?? null,
      'NO_ANCHOR',
    ),
    underpriceMonthPercent: priceComparison(
      input,
      month,
      input.book?.bestAskIsk ?? null,
      input.book ? 'NO_ASK' : 'NO_BOOK',
    ),
    underpriceYearPercent: priceComparison(
      input,
      year,
      input.book?.bestAskIsk ?? null,
      input.book ? 'NO_ASK' : 'NO_BOOK',
    ),
    anchorTradedValueIsk: anchorTradedValueMetric(input),
    weekTradedValueIsk: windowMetric(input, week, BigInt(week.estimatedValueCents), 100n),
    averageDailyValueIsk: windowMetric(
      input,
      week,
      BigInt(week.estimatedValueCents),
      BigInt(week.observedDays) * 100n,
    ),
    averageDailyOrders: windowMetric(
      input,
      week,
      BigInt(week.orderCount),
      BigInt(week.observedDays),
    ),
    anchorVolumeSpike: volumeComparison(input, year, anchorVolume, year),
    weekVolumeSpike: volumeComparison(input, year, meanVolume(week), week),
    bestBidIsk: bookPrice(input, 'bid'),
    bestAskIsk: bookPrice(input, 'ask'),
    spreadIsk: bookSpread(input, false),
    spreadPercent: bookSpread(input, true),
    sellDepth: bookQuantity(input, input.book?.sellDepth ?? null),
    sellDepth5Percent: bookQuantity(input, input.book?.sellDepth5Percent ?? null),
    sellDepth10Percent: bookQuantity(input, input.book?.sellDepth10Percent ?? null),
    daysSupply: supplyMetric(input, week, input.book?.sellDepth ?? null),
    daysSupply10Percent: supplyMetric(input, week, input.book?.sellDepth10Percent ?? null),
  }
}
