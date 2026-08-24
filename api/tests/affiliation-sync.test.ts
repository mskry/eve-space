import { describe, expect, test, vi } from 'vitest'
import {
  affiliationBatchLimit,
  affiliationJobPayload,
  affiliationOperationIdentity,
  AffiliationCooldownError,
  partitionAffiliationCharacterIds,
  processAffiliationBatch,
} from '../src/affiliation-sync.js'
import { EsiQuotaError } from '../src/esi-resilience/cooldowns.js'
import { runAffiliationPlannerWithDependencies } from '../src/queue/affiliation-planner.js'

describe('character affiliation synchronization', () => {
  test('partitions deterministic batches at the SDK operation limit', () => {
    const ids = Array.from({ length: affiliationBatchLimit + 1 }, (_, index) => index + 1)

    expect(partitionAffiliationCharacterIds(ids)).toEqual([
      ids.slice(0, affiliationBatchLimit),
      [affiliationBatchLimit + 1],
    ])
    expect(affiliationOperationIdentity([3, 1, 2])).toBe('affiliation-1-2-3')
  })

  test('rejects oversized and credential-bearing job payloads', () => {
    expect(() =>
      affiliationJobPayload.parse({
        operationId: 'affiliation-1',
        characterIds: Array.from({ length: affiliationBatchLimit + 1 }, (_, index) => index + 1),
      }),
    ).toThrow('Too big')
    expect(() =>
      affiliationJobPayload.parse({
        operationId: 'affiliation-1',
        characterIds: [1],
        accessToken: 'not-allowed',
      }),
    ).toThrow('Unrecognized key')
  })

  test('converts shared ESI cooldowns into worker deferrals before persistence', async () => {
    const lookup = vi.fn().mockRejectedValue(new EsiQuotaError(45))

    await expect(processAffiliationBatch([1], { lookup })).rejects.toEqual(
      new AffiliationCooldownError(45),
    )
  })

  test('pauses planner admission during cooldown and reconstructs deterministic batches after it', async () => {
    const client = { del: vi.fn(), set: vi.fn() }
    const queue = {
      add: vi.fn(),
      getBackend: () => ({ client: Promise.resolve(client) }),
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, delayed: 0 }),
      getJobs: vi.fn().mockResolvedValue([]),
    }

    await expect(
      runAffiliationPlannerWithDependencies(queue as never, undefined, {
        cooldownActive: async () => true,
      }),
    ).resolves.toEqual({ planned: 0, reason: 'cooldown' })
    expect(client.set).toHaveBeenCalledWith('eve-space:v1:planner:state', 'paused')
    expect(client.set).toHaveBeenCalledWith(
      'eve-space:v1:planner:affiliation:outcome',
      expect.stringContaining('"outcome":"cooldown"'),
    )

    await expect(
      runAffiliationPlannerWithDependencies(queue as never, undefined, {
        cooldownActive: async () => false,
        selectDue: async () => [{ characterId: 3 }, { characterId: 1 }, { characterId: 2 }],
      }),
    ).resolves.toEqual({ planned: 1, reason: 'scheduled' })
    expect(queue.add).toHaveBeenCalledWith(
      'affiliation',
      { operationId: 'affiliation-1-2-3', characterIds: [1, 2, 3] },
      expect.objectContaining({ jobId: 'affiliation-1-2-3' }),
    )
    expect(client.set).toHaveBeenCalledWith(
      'eve-space:v1:planner:affiliation:outcome',
      expect.stringContaining('"outcome":"scheduled"'),
    )
  })
})
