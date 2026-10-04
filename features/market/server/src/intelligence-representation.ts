import { z } from 'zod'

export const intelligenceQuantity = z.string().regex(/^(?:0|[1-9]\d{0,79})$/)
const intelligenceDecimalValue = z.string().regex(/^-?(?:0|[1-9]\d{0,79})\.\d{1,6}$/)
export const intelligenceSourceState = z.enum(['uncollected', 'legacy', 'supplied', 'empty'])
const nullReason = z.enum([
  'NO_OBSERVATIONS',
  'SOURCE_UNAVAILABLE',
  'NO_ANCHOR',
  'ZERO_DENOMINATOR',
  'NO_BOOK',
  'NO_ASK',
  'NO_BID',
])
const coverage = z.strictObject({
  windowDays: z.number().int().min(1).max(365),
  observedDays: z.number().int().min(0).max(365),
})
const windowInput = z.strictObject(coverage.shape).extend({
  windowDays: z.union([z.literal(7), z.literal(30), z.literal(365)]),
  volume: intelligenceQuantity,
  orderCount: intelligenceQuantity,
  estimatedValueCents: intelligenceQuantity,
})
const bookInput = z.strictObject({
  bestBidIsk: z.nullable(intelligenceDecimalValue),
  bestAskIsk: z.nullable(intelligenceDecimalValue),
  sellDepth: intelligenceQuantity,
  sellDepth5Percent: z.nullable(intelligenceQuantity),
  sellDepth10Percent: z.nullable(intelligenceQuantity),
})
export const intelligenceMetricInput = z.strictObject({
  sourceState: intelligenceSourceState,
  windows: z.array(windowInput).length(3),
  anchor: z
    .strictObject({ averageIsk: intelligenceDecimalValue, volume: intelligenceQuantity })
    .nullable(),
  book: z.nullable(bookInput),
})
const intelligenceMetric = z.strictObject({
  value: z.nullable(intelligenceDecimalValue),
  numerator: z
    .string()
    .regex(/^-?(?:0|[1-9]\d{0,79})$/)
    .nullable(),
  denominator: z.nullable(intelligenceQuantity),
  nullReason: z.nullable(nullReason),
  observedDays: z.nullable(coverage.shape.observedDays),
  windowDays: z.nullable(coverage.shape.windowDays),
  complete: z.boolean().nullable(),
})
export const intelligenceMetrics = z.strictObject({
  baselineWeekIsk: intelligenceMetric,
  baselineMonthIsk: intelligenceMetric,
  baselineYearIsk: intelligenceMetric,
  weekPriceChangePercent: intelligenceMetric,
  underpriceMonthPercent: intelligenceMetric,
  underpriceYearPercent: intelligenceMetric,
  anchorTradedValueIsk: intelligenceMetric,
  weekTradedValueIsk: intelligenceMetric,
  averageDailyValueIsk: intelligenceMetric,
  averageDailyOrders: intelligenceMetric,
  anchorVolumeSpike: intelligenceMetric,
  weekVolumeSpike: intelligenceMetric,
  bestBidIsk: intelligenceMetric,
  bestAskIsk: intelligenceMetric,
  spreadIsk: intelligenceMetric,
  spreadPercent: intelligenceMetric,
  sellDepth: intelligenceMetric,
  sellDepth5Percent: intelligenceMetric,
  sellDepth10Percent: intelligenceMetric,
  daysSupply: intelligenceMetric,
  daysSupply10Percent: intelligenceMetric,
})

export type IntelligenceWindowInput = Readonly<z.infer<typeof windowInput>>
export type IntelligenceWindowDays = IntelligenceWindowInput['windowDays']
export type IntelligenceNullReason = z.infer<typeof nullReason>
export type IntelligenceCoverage = Readonly<z.infer<typeof coverage>>
export type IntelligenceMetricInput = Readonly<
  Omit<z.infer<typeof intelligenceMetricInput>, 'windows'>
> & {
  readonly windows: readonly IntelligenceWindowInput[]
}
export type IntelligenceMetric = Readonly<z.infer<typeof intelligenceMetric>>
export type IntelligenceMetrics = Readonly<z.infer<typeof intelligenceMetrics>>
