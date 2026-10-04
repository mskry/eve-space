import { z } from 'zod'
import {
  decodeIntelligenceCursor,
  encodeIntelligenceCursor,
  verifyIntelligenceCursor,
} from './intelligence-cursor.js'
import {
  intelligenceHistoryRange,
  intelligenceQuery,
  intelligenceQueryFilters,
} from './intelligence-query.js'
import type { MarketIntelligenceReads } from './intelligence-read-persistence.js'
import { marketReadId, marketReadInput, MarketReadError } from './read-input.js'

const itemInput = z.strictObject({
  profileId: z.uuid(),
  typeId: marketReadId,
  generationId: z.uuid().nullish(),
})
const profileInput = z.strictObject({ profileId: z.uuid() })

export const readMarketIntelligence = async <Value>(
  persistence: Pick<
    MarketIntelligenceReads,
    'readMarketIntelligenceGeneration' | 'readMarketIntelligencePage'
  >,
  value: Value,
  signal: AbortSignal,
) => {
  const query = intelligenceQuery(value)
  const filters = intelligenceQueryFilters(query)
  const cursor = query.after ? decodeIntelligenceCursor(query.after) : null
  if (
    cursor &&
    (cursor.profileId !== query.profileId ||
      (query.generationId && query.generationId !== cursor.generationId))
  )
    throw new MarketReadError('MARKET_INTELLIGENCE_RESTART_REQUIRED', 409)
  signal.throwIfAborted()
  const report = await persistence.readMarketIntelligenceGeneration({
    profileId: query.profileId,
    generationId: cursor?.generationId ?? query.generationId ?? null,
  })
  if (!report) throw new MarketReadError('MARKET_INTELLIGENCE_RESTART_REQUIRED', 409)
  if (cursor)
    await verifyIntelligenceCursor(
      query.after!,
      cursor,
      report.generation,
      filters,
      report.cursorSecret,
    )
  signal.throwIfAborted()
  const page = await persistence.readMarketIntelligencePage({
    ...filters,
    profileId: query.profileId,
    generationId: report.generation.generationId,
    first: query.first,
    lastKey: cursor?.lastKey ?? null,
    lastTypeId: cursor?.lastTypeId ?? null,
  })
  if (!page) throw new MarketReadError('MARKET_INTELLIGENCE_RESTART_REQUIRED', 409)
  const rows = page.rows.slice(0, query.first)
  const hasMore = page.rows.length > query.first
  const last = rows.at(-1)
  return {
    generation: report.generation,
    total: page.total,
    omittedNullSortCount: page.omittedNullSortCount,
    rows: rows.map(({ row }) => row),
    hasMore,
    nextCursor:
      hasMore && last
        ? await encodeIntelligenceCursor(
            report.generation,
            filters,
            report.cursorSecret,
            last.sortKey,
            last.row.typeId,
          )
        : null,
  }
}

export const readMarketIntelligenceItem = async <Value>(
  persistence: Pick<
    MarketIntelligenceReads,
    'readMarketIntelligenceGeneration' | 'readMarketIntelligenceItem'
  >,
  value: Value,
  signal: AbortSignal,
) => {
  const query = marketReadInput(itemInput, value)
  signal.throwIfAborted()
  const report = await persistence.readMarketIntelligenceGeneration({
    profileId: query.profileId,
    generationId: query.generationId ?? null,
  })
  if (!report && query.generationId)
    throw new MarketReadError('MARKET_INTELLIGENCE_RESTART_REQUIRED', 409)
  if (!report)
    return { typeId: query.typeId, status: 'unavailable' as const, generation: null, row: null }
  signal.throwIfAborted()
  const result = await persistence.readMarketIntelligenceItem({
    profileId: query.profileId,
    generationId: report.generation.generationId,
    typeId: query.typeId,
  })
  if (!result) throw new MarketReadError('MARKET_INTELLIGENCE_RESTART_REQUIRED', 409)
  return { ...result, typeId: query.typeId, generation: report.generation }
}

export const readMarketIntelligenceCoverage = async <Value>(
  persistence: Pick<MarketIntelligenceReads, 'readMarketIntelligenceCoverage'>,
  value: Value,
) => {
  const query = marketReadInput(profileInput, value)
  const result = await persistence.readMarketIntelligenceCoverage(query)
  if (!result) throw new MarketReadError('MARKET_INTELLIGENCE_PROFILE_UNAVAILABLE', 404)
  return result
}

export const readMarketIntelligenceHistoryRange = async <Value>(
  persistence: Pick<MarketIntelligenceReads, 'readMarketIntelligenceHistoryRange'>,
  value: Value,
) => {
  const query = intelligenceHistoryRange(value)
  const result = await persistence.readMarketIntelligenceHistoryRange(query)
  if (!result) throw new MarketReadError('MARKET_HISTORY_PROFILE_UNAVAILABLE', 404)
  return result
}
