import { expect, test } from 'vitest'
import type { IntelligenceMetricInput } from '../src/intelligence-representation.js'
import { deriveMarketIntelligenceMetrics } from '../src/intelligence-metrics.js'

const input = (): IntelligenceMetricInput => ({
  sourceState: 'supplied',
  windows: [
    {
      windowDays: 7,
      observedDays: 2,
      volume: '40',
      orderCount: '12',
      estimatedValueCents: '70000',
    },
    {
      windowDays: 30,
      observedDays: 4,
      volume: '100',
      orderCount: '24',
      estimatedValueCents: '200000',
    },
    {
      windowDays: 365,
      observedDays: 10,
      volume: '100',
      orderCount: '40',
      estimatedValueCents: '250000',
    },
  ],
  anchor: { averageIsk: '20.00', volume: '30' },
  book: {
    bestBidIsk: '9.00',
    bestAskIsk: '10.00',
    sellDepth: '100',
    sellDepth5Percent: '30',
    sellDepth10Percent: '40',
  },
})

test('version-one comparisons use volume-weighted supplied windows including the anchor, with independent book and activity metrics', () => {
  const metrics = deriveMarketIntelligenceMetrics(input())
  expect(metrics.baselineWeekIsk).toMatchObject({
    value: '17.500000',
    observedDays: 2,
    windowDays: 7,
    complete: false,
  })
  expect(metrics.weekPriceChangePercent).toMatchObject({
    value: '14.285714',
    numerator: '100000000',
    denominator: '7000000',
  })
  expect(metrics.underpriceMonthPercent.value).toBe('-50.000000')
  expect(metrics.underpriceYearPercent.value).toBe('-60.000000')
  expect(metrics.anchorTradedValueIsk).toMatchObject({
    value: '600.000000',
    windowDays: 1,
    observedDays: 1,
    complete: true,
  })
  expect(metrics.weekTradedValueIsk.value).toBe('700.000000')
  expect(metrics.averageDailyValueIsk.value).toBe('350.000000')
  expect(metrics.averageDailyOrders.value).toBe('6.000000')
  expect(metrics.anchorVolumeSpike).toMatchObject({
    value: '3.000000',
    observedDays: 10,
    windowDays: 365,
  })
  expect(metrics.weekVolumeSpike.value).toBe('2.000000')
  expect(metrics.spreadIsk.value).toBe('1.000000')
  expect(metrics.spreadPercent.value).toBe('10.000000')
  expect(metrics.sellDepth5Percent.value).toBe('30.000000')
  expect(metrics.sellDepth10Percent.value).toBe('40.000000')
  expect(metrics.daysSupply.value).toBe('5.000000')
  expect(metrics.daysSupply10Percent.value).toBe('2.000000')
})

test('large ISK products and quantities retain exact integer fractions without floating point conversion', () => {
  const metrics = deriveMarketIntelligenceMetrics({
    ...input(),
    anchor: { averageIsk: '999999999999999.99', volume: '9000000000000000000' },
    windows: input().windows.map(({ windowDays, orderCount }) => ({
      windowDays,
      orderCount,
      observedDays: windowDays,
      volume: '9000000000000000000',
      estimatedValueCents: '899999999999999991000000000000000000',
    })),
    book: { ...input().book!, sellDepth: '9000000000000000001' },
  })
  expect(metrics.anchorTradedValueIsk.value).toBe('8999999999999999910000000000000000.000000')
  expect(metrics.baselineYearIsk).toMatchObject({ value: '999999999999999.990000', complete: true })
  expect(metrics.sellDepth.numerator).toBe('9000000000000000001')
  expect(metrics.daysSupply).toMatchObject({
    numerator: '63000000000000000007',
    denominator: '9000000000000000000',
    value: '7.000000',
  })
})

test('an absent anchor does not fabricate yesterday price or value while sparse baselines remain usable', () => {
  const metrics = deriveMarketIntelligenceMetrics({ ...input(), anchor: null })
  expect(metrics.weekPriceChangePercent.nullReason).toBe('NO_ANCHOR')
  expect(metrics.anchorTradedValueIsk).toMatchObject({
    value: null,
    nullReason: 'NO_ANCHOR',
    observedDays: 0,
    complete: false,
  })
  expect(metrics.anchorVolumeSpike.nullReason).toBe('NO_ANCHOR')
  expect(metrics.weekTradedValueIsk.value).toBe('700.000000')
})

test('supplied zero-volume days count toward coverage but cannot supply a denominator', () => {
  const metrics = deriveMarketIntelligenceMetrics({
    ...input(),
    anchor: { averageIsk: '0.00', volume: '0' },
    windows: input().windows.map(({ windowDays, observedDays, orderCount }) => ({
      windowDays,
      observedDays,
      orderCount,
      volume: '0',
      estimatedValueCents: '0',
    })),
  })
  expect(metrics.baselineWeekIsk).toMatchObject({ nullReason: 'ZERO_DENOMINATOR', observedDays: 2 })
  expect(metrics.daysSupply.nullReason).toBe('ZERO_DENOMINATOR')
  expect(metrics.anchorVolumeSpike.nullReason).toBe('ZERO_DENOMINATOR')
  expect(metrics.averageDailyValueIsk.value).toBe('0.000000')
  expect(metrics.anchorTradedValueIsk.value).toBe('0.000000')
})

test.each(['uncollected', 'legacy', 'empty'] as const)(
  'latest %s evidence makes history comparisons unavailable without hiding book evidence',
  (sourceState) => {
    const metrics = deriveMarketIntelligenceMetrics({ ...input(), sourceState })
    expect(metrics.averageDailyValueIsk.nullReason).toBe('SOURCE_UNAVAILABLE')
    expect(metrics.anchorTradedValueIsk.nullReason).toBe('SOURCE_UNAVAILABLE')
    expect(metrics.underpriceMonthPercent.nullReason).toBe('SOURCE_UNAVAILABLE')
    expect(metrics.bestAskIsk.value).toBe('10.000000')
  },
)

test('missing books, complete empty books, absent asks, and zero asks have distinct null outcomes', () => {
  const missing = deriveMarketIntelligenceMetrics({ ...input(), book: null })
  expect(missing.sellDepth.nullReason).toBe('NO_BOOK')
  expect(missing.underpriceMonthPercent.nullReason).toBe('NO_BOOK')
  const empty = deriveMarketIntelligenceMetrics({
    ...input(),
    book: {
      bestBidIsk: null,
      bestAskIsk: null,
      sellDepth: '0',
      sellDepth5Percent: null,
      sellDepth10Percent: null,
    },
  })
  expect(empty.sellDepth.value).toBe('0.000000')
  expect(empty.daysSupply.value).toBe('0.000000')
  expect(empty.daysSupply10Percent.nullReason).toBe('NO_ASK')
  const zero = deriveMarketIntelligenceMetrics({
    ...input(),
    book: { ...input().book!, bestAskIsk: '0.00' },
  })
  expect(zero.spreadPercent.nullReason).toBe('ZERO_DENOMINATOR')
  expect(zero.underpriceMonthPercent.value).toBe('-100.000000')
})

test('no observations stay unknown rather than becoming zero daily activity', () => {
  const metrics = deriveMarketIntelligenceMetrics({
    ...input(),
    windows: input().windows.map(({ windowDays }) => ({
      windowDays,
      observedDays: 0,
      volume: '0',
      orderCount: '0',
      estimatedValueCents: '0',
    })),
  })
  expect(metrics.averageDailyOrders.nullReason).toBe('NO_OBSERVATIONS')
  expect(metrics.weekVolumeSpike.nullReason).toBe('NO_OBSERVATIONS')
})

test('unavailable legacy anchors outside the active price contract cannot stop book-only derivation', () => {
  const metrics = deriveMarketIntelligenceMetrics({
    ...input(),
    sourceState: 'legacy',
    anchor: { averageIsk: '999999999999999999.99', volume: '1' },
  })
  expect(metrics.anchorTradedValueIsk.nullReason).toBe('SOURCE_UNAVAILABLE')
  expect(metrics.bestAskIsk.value).toBe('10.000000')
})
