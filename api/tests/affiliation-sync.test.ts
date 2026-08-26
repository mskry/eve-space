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
import { runAffiliationPlanner } from '../src/queue/affiliation-planner.js'

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
      runAffiliationPlanner(queue as never, undefined, {
        dependencies: { cooldownActive: async () => true },
      }),
    ).resolves.toEqual({ planned: 0, reason: 'cooldown' })
    expect(client.set).toHaveBeenCalledWith('eve-space:v1:planner:state', 'paused')
    expect(client.set).toHaveBeenCalledWith(
      'eve-space:v1:planner:affiliation:outcome',
      expect.stringContaining('"outcome":"cooldown"'),
    )

    await expect(
      runAffiliationPlanner(queue as never, undefined, {
        dependencies: {
          cooldownActive: async () => false,
          selectDue: async () => [{ characterId: 3 }, { characterId: 1 }, { characterId: 2 }],
        },
      }),
    ).resolves.toEqual({ planned: 1, reason: 'scheduled' })
    const call = queue.add.mock.calls[0]
    if (!call) throw new Error('Expected planner to enqueue an affiliation batch')
    const [, payload, options] = call
    expect(payload).toEqual({
      operationId: expect.stringMatching(/^affiliation-1-2-3--[0-9a-f-]{36}$/),
      characterIds: [1, 2, 3],
    })
    expect(options).toEqual(expect.objectContaining({ jobId: payload.operationId }))
    expect(client.set).toHaveBeenCalledWith(
      'eve-space:v1:planner:affiliation:outcome',
      expect.stringContaining('"outcome":"scheduled"'),
    )
  })

  test('gives recurring batches distinct job identities', async () => {
    const client = { del: vi.fn(), set: vi.fn() }
    const queue = {
      add: vi.fn(),
      getBackend: () => ({ client: Promise.resolve(client) }),
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, delayed: 0 }),
      getJobs: vi.fn().mockResolvedValue([]),
    }
    const dependencies = {
      cooldownActive: async () => false,
      selectDue: async () => [{ characterId: 1 }],
    }

    await runAffiliationPlanner(queue as never, undefined, { dependencies })
    await runAffiliationPlanner(queue as never, undefined, { dependencies })

    const firstCall = queue.add.mock.calls[0]
    const secondCall = queue.add.mock.calls[1]
    if (!firstCall || !secondCall) throw new Error('Expected both planner runs to enqueue a batch')
    const first = firstCall[1].operationId
    const second = secondCall[1].operationId
    expect(first).not.toBe(second)
    expect(firstCall[2]).toEqual(expect.objectContaining({ jobId: first }))
    expect(secondCall[2]).toEqual(expect.objectContaining({ jobId: second }))
  })
})
