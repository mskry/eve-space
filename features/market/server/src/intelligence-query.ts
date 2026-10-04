import { z } from 'zod'
import { intelligenceMetrics } from './intelligence-representation.js'
import { marketIntelligenceMetricDefinitions } from './intelligence-definitions.js'
import { marketReadId, marketReadInput, MarketReadError } from './read-input.js'

const selector = z
  .array(marketReadId)
  .max(100)
  .nullish()
  .transform((values) => [...new Set(values ?? [])].toSorted((left, right) => left - right))
const threshold = z.string().regex(/^(?:0|[1-9]\d{0,79})(?:\.\d{1,6})?$/)
export const intelligenceMetricId = z.keyof(intelligenceMetrics)
const input = z.strictObject({
  profileId: z.uuid(),
  generationId: z.uuid().nullish(),
  typeIds: selector,
  groupIds: selector,
  first: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullish()
    .transform((value) => value ?? 25),
  after: z.string().min(1).max(4096).nullish(),
  minimumAverageDailyValueIsk: z.nullish(threshold).transform((value) => value ?? '5000000000'),
  minimumAverageDailyOrders: z.nullish(threshold).transform((value) => value ?? '5'),
  minimumBaselineDays: z
    .number()
    .int()
    .min(0)
    .max(365)
    .nullish()
    .transform((value) => value ?? 0),
  includeStale: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  sort: z.nullish(intelligenceMetricId).transform((value) => value ?? 'anchorTradedValueIsk'),
  direction: z
    .enum(['ASC', 'DESC'])
    .nullish()
    .transform((value) => value ?? 'DESC'),
})
export type IntelligenceQuery = z.infer<typeof input>

export const intelligenceQuery = <Value>(value: Value) => {
  const query = marketReadInput(input, value)
  const definition = marketIntelligenceMetricDefinitions().find(({ id }) => id === query.sort)!
  if (query.minimumBaselineDays > (definition.windowDays ?? 0))
    throw new MarketReadError('INVALID_MARKET_BASELINE_COVERAGE', 400)
  return query
}

export const intelligenceQueryFilters = (query: IntelligenceQuery) => {
  const definition = marketIntelligenceMetricDefinitions().find(({ id }) => id === query.sort)!
  const needsActivity =
    BigInt(query.minimumAverageDailyValueIsk.split('.')[0]!) > 0n ||
    BigInt(query.minimumAverageDailyOrders.split('.')[0]!) > 0n ||
    /[1-9]/.test(query.minimumAverageDailyValueIsk.split('.')[1] ?? '') ||
    /[1-9]/.test(query.minimumAverageDailyOrders.split('.')[1] ?? '')
  return {
    typeIds: query.typeIds,
    groupIds: query.groupIds,
    minimumAverageDailyValueIsk: query.minimumAverageDailyValueIsk,
    minimumAverageDailyOrders: query.minimumAverageDailyOrders,
    minimumBaselineDays: query.minimumBaselineDays,
    includeStale: query.includeStale,
    sort: query.sort,
    direction: query.direction,
    needsHistory: definition.source !== 'book' || needsActivity,
    needsBook: definition.source !== 'history',
  }
}

const intelligenceHistoryRangeInput = z.strictObject({
  profileId: z.uuid(),
  typeId: marketReadId,
  from: z.iso.date(),
  through: z.iso.date(),
})
export const intelligenceHistoryRange = <Value>(value: Value, now = Date.now()) => {
  const query = marketReadInput(intelligenceHistoryRangeInput, value)
  const from = Date.parse(query.from)
  const through = Date.parse(query.through)
  const today = Date.parse(new Date(now).toISOString().slice(0, 10))
  if (through < from || through >= today || from < today - 365 * 86400000)
    throw new MarketReadError('INVALID_MARKET_HISTORY_RANGE', 400)
  return query
}
