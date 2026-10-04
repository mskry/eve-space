import { expect, test, vi } from 'vitest'
import { deriveMarketIntelligence } from '../src/intelligence-derivation.js'

type DerivationContext = Parameters<typeof deriveMarketIntelligence>[0]
type Persistence = DerivationContext['capabilities']['persistence']

const fixture = (count: number, controller = new AbortController()) => {
  const generationId = crypto.randomUUID()
  const profile = {
    profileId: crypto.randomUUID(),
    revision: 1,
    regionId: 10000002,
    mode: 'region' as const,
    stationIds: [],
    watchedTypeIds: [],
    enabled: true,
    nextDueAt: null,
    lastFailureClass: null,
  } satisfies Parameters<typeof deriveMarketIntelligence>[1]
  let cursorTypeId = 0
  const input = {
    sourceState: 'uncollected' as const,
    anchor: null,
    book: null,
    windows: ([7, 30, 365] as const).map((windowDays) => ({
      windowDays,
      observedDays: 0,
      volume: '0',
      orderCount: '0',
      estimatedValueCents: '0',
    })),
  }
  const persistence = {
    readMarketIntelligenceInputPage: vi.fn<Persistence['readMarketIntelligenceInputPage']>(
      async () => ({
        generationId,
        cursorTypeId,
        rows: Array.from({ length: Math.min(100, count - cursorTypeId) }, (_, index) => ({
          typeId: cursorTypeId + index + 1,
          groupId: 1,
          groupIds: [1],
          name: 'Frozen type',
          historySource: {
            state: 'uncollected' as const,
            validatedAt: null,
            freshUntil: null,
            contentRevision: '0',
            lastAttemptAt: null,
            lastFailureClass: null,
          },
          bookSource: null,
          metricsInput: input,
        })),
      }),
    ),
    stageMarketIntelligenceOutputs: vi.fn<Persistence['stageMarketIntelligenceOutputs']>(
      async ({ rows }) => {
        cursorTypeId = rows.at(-1)!.typeId
        return { outcome: 'staged' as const }
      },
    ),
    publishMarketIntelligenceGeneration: vi.fn<Persistence['publishMarketIntelligenceGeneration']>(
      async () => ({ outcome: 'published' }),
    ),
    recordMarketIntelligenceCatalogue: vi.fn<Persistence['recordMarketIntelligenceCatalogue']>(
      async () => {
        throw new Error('Unexpected catalogue write while resuming')
      },
    ),
    beginMarketIntelligenceGeneration: vi.fn<Persistence['beginMarketIntelligenceGeneration']>(
      async () => {
        throw new Error('Unexpected generation creation while resuming')
      },
    ),
    readMarketIntelligencePolicy: vi.fn<Persistence['readMarketIntelligencePolicy']>(async () => {
      throw new Error('Unexpected policy read while resuming')
    }),
    readMarketIntelligenceUniverse: vi.fn<Persistence['readMarketIntelligenceUniverse']>(
      async () => {
        throw new Error('Unexpected universe read while resuming')
      },
    ),
  }
  const context = {
    profileId: profile.profileId,
    expectedRevision: 1,
    signal: controller.signal,
    assertCurrent: vi.fn(async () => true),
    capabilities: {
      persistence,
      coreData: {
        marketCatalogue: vi.fn<DerivationContext['capabilities']['coreData']['marketCatalogue']>(
          async () => {
            throw new Error('Unexpected catalogue read while resuming a region')
          },
        ),
      },
    },
  } satisfies DerivationContext
  return { profile, context, persistence, cursor: () => cursorTypeId }
}

test('large frozen universes resume after exactly 64 hundred-type pages and publish only after exhaustion', async () => {
  const state = fixture(6501)
  expect(await deriveMarketIntelligence(state.context, state.profile)).toBe('completed')
  expect(state.cursor()).toBe(6400)
  expect(state.persistence.stageMarketIntelligenceOutputs).toHaveBeenCalledTimes(64)
  expect(state.persistence.publishMarketIntelligenceGeneration).not.toHaveBeenCalled()
  expect(await deriveMarketIntelligence(state.context, state.profile)).toBe('completed')
  expect(state.cursor()).toBe(6501)
  expect(state.persistence.publishMarketIntelligenceGeneration).toHaveBeenCalledTimes(1)
})

test('cancellation between pages leaves committed progress resumable and prevents publication', async () => {
  const controller = new AbortController()
  const state = fixture(205, controller)
  const stage = state.persistence.stageMarketIntelligenceOutputs.getMockImplementation()!
  state.persistence.stageMarketIntelligenceOutputs.mockImplementationOnce(async (input) => {
    const result = await stage(input)
    controller.abort()
    return result
  })
  await expect(deriveMarketIntelligence(state.context, state.profile)).rejects.toThrow(/aborted/)
  expect(state.cursor()).toBe(100)
  expect(state.persistence.publishMarketIntelligenceGeneration).not.toHaveBeenCalled()
  expect(
    await deriveMarketIntelligence(
      { ...state.context, signal: new AbortController().signal, assertCurrent: async () => true },
      state.profile,
    ),
  ).toBe('completed')
  expect(state.cursor()).toBe(205)
})
