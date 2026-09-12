import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  affiliationBatchLimit,
  affiliationJobPayload,
  affiliationOperationIdentity,
  AffiliationCooldownError,
  partitionAffiliationCharacterIds,
  processAffiliationBatch,
} from '../../src/characters/affiliation-sync.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import { runAffiliationPlanner } from '../../src/queue/affiliation-planner.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const plannerMocks = vi.hoisted(() => ({
  cooldownActive: vi.fn(),
  selectDue: vi.fn(),
}))

vi.mock('../../src/characters/affiliation-planning.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/characters/affiliation-planning.js')>()),
  affiliationCooldownActive: plannerMocks.cooldownActive,
}))
vi.mock('../../src/characters/affiliation-sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/characters/affiliation-sync.js')>()),
  selectDueAffiliationCharacterIds: plannerMocks.selectDue,
}))

beforeEach(() => {
  plannerMocks.cooldownActive.mockReset().mockResolvedValue(false)
  plannerMocks.selectDue.mockReset().mockResolvedValue([])
})

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

    const error = await processAffiliationBatch([1], { lookup }).catch(
      (caughtError: unknown) => caughtError,
    )

    expect(error).toBeInstanceOf(AffiliationCooldownError)
    expect(error).toMatchObject({
      message: 'Character affiliation refresh is deferred by ESI cooldown',
      retryAfterSeconds: 45,
      retryAt: expect.any(Date),
    })
  })

  test('pauses planner admission during cooldown and reconstructs deterministic batches after it', async () => {
    const producer = createInMemoryQueueProducer()
    const outcomes = outcomeRecorder()
    plannerMocks.cooldownActive.mockResolvedValueOnce(true)

    await expect(runAffiliationPlanner({ producer, outcomes })).resolves.toEqual({
      planned: 0,
      reason: 'cooldown',
    })
    expect(producer.plannerPaused).toBe(true)
    expect(outcomes.recordAffiliation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'cooldown' }),
    )

    plannerMocks.selectDue.mockResolvedValueOnce([
      { characterId: 3 },
      { characterId: 1 },
      { characterId: 2 },
    ])
    await expect(runAffiliationPlanner({ producer, outcomes })).resolves.toEqual({
      planned: 1,
      reason: 'scheduled',
    })
    const command = producer.commands[0]
    if (command?.name !== 'affiliation') throw new Error('Expected an affiliation command')
    const payload = command.payload
    expect(payload).toEqual({
      operationId: expect.stringMatching(/^affiliation-1-2-3--[0-9a-f-]{36}$/),
      characterIds: [1, 2, 3],
    })
    expect(outcomes.recordAffiliation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'scheduled' }),
    )
  })

  test('gives recurring batches distinct job identities', async () => {
    const producer = createInMemoryQueueProducer()
    const outcomes = outcomeRecorder()
    plannerMocks.selectDue.mockResolvedValue([{ characterId: 1 }])

    await runAffiliationPlanner({ producer, outcomes })
    await runAffiliationPlanner({ producer, outcomes })

    const firstCommand = producer.commands[0]
    const secondCommand = producer.commands[1]
    if (firstCommand?.name !== 'affiliation' || secondCommand?.name !== 'affiliation')
      throw new Error('Expected both planner runs to enqueue a batch')
    const first = firstCommand.payload.operationId
    const second = secondCommand.payload.operationId
    expect(first).not.toBe(second)
  })

  test('keeps planning outcomes authoritative when observability recording fails', async () => {
    const planningFailure = new Error('selection failed')
    const outcomes = outcomeRecorder()
    outcomes.recordAffiliation.mockRejectedValue(new Error('Redis outcome unavailable'))

    await expect(
      runAffiliationPlanner({ producer: createInMemoryQueueProducer(), outcomes }),
    ).resolves.toEqual({ planned: 0, reason: 'scheduled' })

    plannerMocks.selectDue.mockRejectedValueOnce(planningFailure)
    await expect(
      runAffiliationPlanner({ producer: createInMemoryQueueProducer(), outcomes }),
    ).rejects.toBe(planningFailure)
  })
})

function outcomeRecorder() {
  return {
    recordAffiliation: vi.fn().mockResolvedValue(undefined),
    recordOutbox: vi.fn().mockResolvedValue(undefined),
  }
}
