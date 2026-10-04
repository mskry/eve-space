import { expect, test, vi } from 'vitest'
import { reconcileMarketIntelligence } from '../src/intelligence-reconciliation.js'
import { platformPersistencePayloadMaximumBytes } from '@eve-space/platform-module-server'

const revision = { buildNumber: 3552227, ingestVersion: 6, ingestedAt: '2026-10-04T00:00:00Z' }
const profileId = '00000000-0000-4000-8000-000000000001'
const setup = () => {
  const persistence = {
    readMarketIntelligencePolicy: vi.fn().mockResolvedValue({
      enabled: true,
      revision: 1,
      ignoredGroupIds: [],
      catalogueRevision: revision,
    }),
    readMarketIntelligenceUniverse: vi.fn().mockResolvedValue({ active: null, staging: null }),
    listDueMarketIntelligenceReconciliations: vi.fn(),
    beginMarketIntelligenceUniverse: vi.fn().mockResolvedValue({ outcome: 'started' }),
    stageMarketIntelligenceTargets: vi.fn().mockResolvedValue({ outcome: 'staged' }),
    stageMarketIntelligenceExclusions: vi.fn().mockResolvedValue({ outcome: 'staged' }),
    activateMarketIntelligenceUniverse: vi.fn().mockResolvedValue({ outcome: 'activated' }),
    recordMarketIntelligenceReconciliation: vi.fn().mockResolvedValue({ outcome: 'recorded' }),
  }
  const coreData = {
    marketCatalogue: vi.fn(async (input: { kind: string }) =>
      input.kind === 'tree'
        ? {
            kind: 'tree',
            complete: true,
            revision,
            groups: [{ id: 1, parentId: null, name: 'Group', iconId: null, directTypeCount: 0 }],
          }
        : {
            kind: 'search-index',
            complete: true,
            revision,
            types: Array.from({ length: 2001 }, (_, position) => ({
              id: position + 1,
              groupId: 1,
              name: `Item ${position}`,
            })),
          },
    ),
  }
  const controller = new AbortController()
  const context = {
    profileId,
    expectedRevision: 1,
    capabilities: {
      persistence,
      coreData,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
    signal: controller.signal,
    assertCurrent: vi.fn().mockResolvedValue(true),
  }
  return { context, persistence, coreData, controller }
}

test('stages finite byte-bounded batches before activating a complete universe', async () => {
  const { context, persistence } = setup()
  expect(await reconcileMarketIntelligence(context, 10000002)).toBe('completed')
  const batches = persistence.stageMarketIntelligenceTargets.mock.calls.map(([input]) => input)
  expect(batches.map((batch) => batch.targets.length)).toEqual([1000, 1000, 1])
  expect(
    batches.every(
      (batch) =>
        new TextEncoder().encode(JSON.stringify(batch)).byteLength <=
        platformPersistencePayloadMaximumBytes,
    ),
  ).toBe(true)
  expect(persistence.activateMarketIntelligenceUniverse).toHaveBeenCalledOnce()
})

test('reconstructs interrupted staging under the same universe identity and never activates partial work', async () => {
  const { context, persistence } = setup()
  const universeId = '00000000-0000-4000-8000-000000000002'
  persistence.readMarketIntelligenceUniverse.mockResolvedValue({
    active: null,
    staging: { universeId, catalogueRevision: revision },
  })
  persistence.stageMarketIntelligenceTargets.mockRejectedValueOnce(new Error('Interrupted'))
  await expect(reconcileMarketIntelligence(context, 10000002)).rejects.toThrow('Interrupted')
  expect(persistence.activateMarketIntelligenceUniverse).not.toHaveBeenCalled()
  expect(await reconcileMarketIntelligence(context, 10000002)).toBe('completed')
  expect(persistence.activateMarketIntelligenceUniverse).toHaveBeenCalledWith({
    profileId,
    profileRevision: 1,
    policyRevision: 1,
    universeId,
  })
})

test('keeps a matching active universe and rejects catalogue races or cancellation before publication', async () => {
  const { context, persistence, coreData, controller } = setup()
  persistence.readMarketIntelligenceUniverse.mockResolvedValue({
    active: { universeId: profileId, catalogueRevision: revision },
    staging: null,
  })
  expect(await reconcileMarketIntelligence(context, 10000002)).toBe('completed')
  expect(persistence.beginMarketIntelligenceUniverse).not.toHaveBeenCalled()
  const read = coreData.marketCatalogue.getMockImplementation()!
  coreData.marketCatalogue.mockImplementation(async (input) => ({
    ...(await read(input)),
    revision: { ...revision, ingestVersion: input.kind === 'tree' ? 6 : 7 },
  }))
  await expect(reconcileMarketIntelligence(context, 10000002)).rejects.toThrow('revisions')
  controller.abort()
  await expect(reconcileMarketIntelligence(context, 10000002)).rejects.toThrow(/aborted/)
  expect(persistence.activateMarketIntelligenceUniverse).not.toHaveBeenCalled()
})
