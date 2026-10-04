import type { IntelligenceMetrics } from './intelligence-representation.js'
import { marketIntelligenceFormulaVersion } from './intelligence-metrics.js'

const definitions = [
  ['baselineWeekIsk', 'ISK', 7, 'history', 'sum(averageIsk * volume) / sum(volume)'],
  ['baselineMonthIsk', 'ISK', 30, 'history', 'sum(averageIsk * volume) / sum(volume)'],
  ['baselineYearIsk', 'ISK', 365, 'history', 'sum(averageIsk * volume) / sum(volume)'],
  [
    'weekPriceChangePercent',
    'percent',
    7,
    'history',
    '(anchorAverageIsk / baselineWeekIsk - 1) * 100',
  ],
  [
    'underpriceMonthPercent',
    'percent',
    30,
    'history-and-book',
    '(bestAskIsk / baselineMonthIsk - 1) * 100',
  ],
  [
    'underpriceYearPercent',
    'percent',
    365,
    'history-and-book',
    '(bestAskIsk / baselineYearIsk - 1) * 100',
  ],
  ['anchorTradedValueIsk', 'ISK', 1, 'history', 'anchorAverageIsk * anchorVolume'],
  ['weekTradedValueIsk', 'ISK', 7, 'history', 'sum(averageIsk * volume)'],
  ['averageDailyValueIsk', 'ISK/day', 7, 'history', 'sum(averageIsk * volume) / observedDays'],
  ['averageDailyOrders', 'orders/day', 7, 'history', 'sum(orderCount) / observedDays'],
  ['anchorVolumeSpike', 'ratio', 365, 'history', 'anchorVolume / meanSuppliedYearVolume'],
  ['weekVolumeSpike', 'ratio', 365, 'history', 'meanSuppliedWeekVolume / meanSuppliedYearVolume'],
  ['bestBidIsk', 'ISK', null, 'book', 'maximum eligible buy price'],
  ['bestAskIsk', 'ISK', null, 'book', 'minimum eligible sell price'],
  ['spreadIsk', 'ISK', null, 'book', 'bestAskIsk - bestBidIsk'],
  ['spreadPercent', 'percent', null, 'book', '(bestAskIsk - bestBidIsk) / bestAskIsk * 100'],
  ['sellDepth', 'units', null, 'book', 'sum(eligible remaining sell quantity)'],
  [
    'sellDepth5Percent',
    'units',
    null,
    'book',
    'sum(remaining sell quantity where price <= bestAskIsk * 1.05)',
  ],
  [
    'sellDepth10Percent',
    'units',
    null,
    'book',
    'sum(remaining sell quantity where price <= bestAskIsk * 1.10)',
  ],
  ['daysSupply', 'days', 7, 'history-and-book', 'sellDepth / meanSuppliedWeekVolume'],
  [
    'daysSupply10Percent',
    'days',
    7,
    'history-and-book',
    'sellDepth10Percent / meanSuppliedWeekVolume',
  ],
] as const satisfies readonly (readonly [
  keyof IntelligenceMetrics,
  string,
  number | null,
  'history' | 'book' | 'history-and-book',
  string,
])[]

export const marketIntelligenceMetricDefinitions = () =>
  definitions.map(([id, unit, windowDays, source, formula]) => ({
    id,
    unit,
    windowDays,
    source,
    formula,
    formulaVersion: marketIntelligenceFormulaVersion,
    includesAnchor: windowDays !== null,
    decimalPlaces: 6,
    rounding: 'truncate-toward-zero' as const,
  }))
