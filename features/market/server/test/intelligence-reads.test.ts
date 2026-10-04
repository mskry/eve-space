import { expect, test, vi } from 'vitest'
import {
  readMarketIntelligence,
  readMarketIntelligenceItem,
  readMarketIntelligenceHistoryRange,
} from '../src/intelligence-reads.js'
import type { MarketIntelligenceReads } from '../src/intelligence-read-persistence.js'

const profileId = crypto.randomUUID()
const generation = {
  generationId: crypto.randomUUID(),
  profileId,
  profileRevision: '1',
  policyRevision: '1',
  catalogueRevision: { buildNumber: 1, ingestVersion: 1, ingestedAt: '2026-10-04T00:00:00Z' },
  formulaVersion: 1 as const,
  anchorDate: '2026-10-03',
  regionId: 10000002,
  bookScope: 'region' as const,
  historyScope: 'region' as const,
  targetCount: 2,
  excludedTypeCount: 0,
  createdAt: '2026-10-04T00:00:00Z',
  publishedAt: '2026-10-04T00:01:00Z',
  expiresAt: null,
}
const row = (typeId: number) => ({
  typeId,
  groupId: 1,
  name: 'Type',
  historySource: {
    state: 'uncollected' as const,
    validatedAt: null,
    freshUntil: null,
    contentRevision: '0',
    lastAttemptAt: null,
    lastFailureClass: null,
  },
  bookSource: null,
  metrics: {},
})
const store = () => ({
  readMarketIntelligenceGeneration: vi
    .fn<MarketIntelligenceReads['readMarketIntelligenceGeneration']>()
    .mockResolvedValue({ generation, cursorSecret: crypto.randomUUID() }),
  readMarketIntelligencePage: vi
    .fn<MarketIntelligenceReads['readMarketIntelligencePage']>()
    .mockResolvedValue({
      total: 2,
      omittedNullSortCount: 3,
      rows: [
        { sortKey: '9007199254740993.1', row: row(1) },
        { sortKey: '9007199254740993.1', row: row(2) },
      ],
    }),
})
const signal = () => new AbortController().signal

test('validates every expensive-read bound before calling persistence', async () => {
  const persistence = store()
  for (const extra of [
    { first: 101 },
    { first: 0 },
    { minimumAverageDailyValueIsk: '-1' },
    { minimumAverageDailyOrders: 'NaN' },
    { sort: 'median' },
    { typeIds: Array.from({ length: 101 }, (_, i) => String(i + 1)) },
    { groupIds: Array.from({ length: 101 }, (_, i) => String(i + 1)) },
    { minimumBaselineDays: 8, sort: 'baselineWeekIsk' },
    { sort: 'bestAskIsk', minimumBaselineDays: 1 },
  ]) {
    await expect(
      readMarketIntelligence(persistence, { profileId, ...extra }, signal()),
    ).rejects.toMatchObject({ status: 400 })
  }
  expect(persistence.readMarketIntelligenceGeneration).not.toHaveBeenCalled()
  expect(persistence.readMarketIntelligencePage).not.toHaveBeenCalled()
})

test('pins cursors to exact report and normalized filters while retaining large sort keys and allowing page-size changes', async () => {
  const persistence = store()
  const first = await readMarketIntelligence(
    persistence,
    { profileId, first: 1, typeIds: ['2', '1', '2'], groupIds: ['3', '1'] },
    signal(),
  )
  expect(first).toMatchObject({
    total: 2,
    omittedNullSortCount: 3,
    hasMore: true,
    rows: [{ typeId: 1 }],
  })
  expect(JSON.stringify(first)).not.toContain('cursorSecret')
  persistence.readMarketIntelligencePage.mockClear()
  await readMarketIntelligence(
    persistence,
    { profileId, first: 2, after: first.nextCursor, typeIds: ['1', '2'], groupIds: ['1', '3'] },
    signal(),
  )
  expect(persistence.readMarketIntelligenceGeneration).toHaveBeenLastCalledWith({
    profileId,
    generationId: generation.generationId,
  })
  expect(persistence.readMarketIntelligencePage).toHaveBeenCalledWith(
    expect.objectContaining({
      first: 2,
      lastKey: '9007199254740993.1',
      lastTypeId: 1,
      minimumAverageDailyValueIsk: '5000000000',
      minimumAverageDailyOrders: '5',
    }),
  )
})

test('rejects tampering, changed filters, policy revisions, and retired generations before reading ranked outputs', async () => {
  const persistence = store()
  const first = await readMarketIntelligence(persistence, { profileId, first: 1 }, signal())
  persistence.readMarketIntelligencePage.mockClear()
  const [payload, signature] = first.nextCursor!.split('.')
  const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
  forged.lastTypeId = 999
  const tampered = Buffer.from(JSON.stringify(forged)).toString('base64url') + '.' + signature
  for (const extra of [
    { after: tampered },
    { after: first.nextCursor, includeStale: true },
    { after: first.nextCursor, sort: 'baselineWeekIsk' },
    { after: first.nextCursor, minimumAverageDailyOrders: '0' },
    { after: first.nextCursor, generationId: crypto.randomUUID() },
  ]) {
    await expect(
      readMarketIntelligence(persistence, { profileId, ...extra }, signal()),
    ).rejects.toMatchObject({ code: 'MARKET_INTELLIGENCE_RESTART_REQUIRED' })
  }
  const secret = (await persistence.readMarketIntelligenceGeneration({
    profileId,
    generationId: null,
  }))!.cursorSecret
  persistence.readMarketIntelligenceGeneration.mockResolvedValue({
    generation: { ...generation, policyRevision: '2' },
    cursorSecret: secret,
  })
  await expect(
    readMarketIntelligence(persistence, { profileId, after: first.nextCursor }, signal()),
  ).rejects.toMatchObject({ status: 409 })
  persistence.readMarketIntelligenceGeneration.mockResolvedValue(null)
  await expect(
    readMarketIntelligence(persistence, { profileId, after: first.nextCursor }, signal()),
  ).rejects.toMatchObject({ status: 409 })
  expect(persistence.readMarketIntelligencePage).not.toHaveBeenCalled()
})

test('cancelled requests stop before backend work and unknown item reads remain read-only', async () => {
  const persistence = store()
  const controller = new AbortController()
  controller.abort()
  await expect(
    readMarketIntelligence(persistence, { profileId }, controller.signal),
  ).rejects.toThrow(/aborted/)
  expect(persistence.readMarketIntelligenceGeneration).not.toHaveBeenCalled()
  const items = {
    readMarketIntelligenceGeneration: persistence.readMarketIntelligenceGeneration,
    readMarketIntelligenceItem: vi
      .fn<MarketIntelligenceReads['readMarketIntelligenceItem']>()
      .mockResolvedValue({ status: 'ignored', row: null }),
  }
  expect(
    await readMarketIntelligenceItem(items, { profileId, typeId: '999' }, signal()),
  ).toMatchObject({ status: 'ignored', row: null })
})

test('history ranges reject today, reversed and outside-retention dates before persistence', async () => {
  const persistence = {
    readMarketIntelligenceHistoryRange:
      vi.fn<MarketIntelligenceReads['readMarketIntelligenceHistoryRange']>(),
  }
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const old = new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10)
  for (const [from, through] of [
    [yesterday, today],
    [today, yesterday],
    [old, yesterday],
  ])
    await expect(
      readMarketIntelligenceHistoryRange(persistence, { profileId, typeId: '1', from, through }),
    ).rejects.toMatchObject({ status: 400 })
  expect(persistence.readMarketIntelligenceHistoryRange).not.toHaveBeenCalled()
})
