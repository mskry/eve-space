import { beforeEach, describe, expect, test, vi } from 'vitest'
import { processAffiliationBatch } from '../../src/characters/affiliation-sync.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import { runAffiliationPlanner } from '../../src/queue/affiliation-planner.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const plannerMocks = vi.hoisted(() => ({
  cooldownActive: vi.fn(),
  executeRepresentation: vi.fn(),
  selectDue: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', async () => {
  const { createFeatureExecutionMock } = await import('../support/mock-feature-execution.js')
  return createFeatureExecutionMock(plannerMocks.executeRepresentation)
})
vi.mock('../../src/characters/affiliation-planning.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/characters/affiliation-planning.js')>()),
  affiliationCooldownActive: plannerMocks.cooldownActive,
}))
vi.mock('../../src/characters/affiliation-sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/characters/affiliation-sync.js')>()),
  selectDueAffiliationBatches: plannerMocks.selectDue,
}))

beforeEach(() => {
  plannerMocks.cooldownActive.mockReset().mockResolvedValue(false)
  plannerMocks.executeRepresentation.mockReset().mockResolvedValue({
    data: [],
    cachedUntil: '2026-09-12T13:00:00.000Z',
    validatedAt: '2026-09-12T12:00:00.000Z',
    source: 'esi',
    stale: false,
    quota: {},
  })
  plannerMocks.selectDue.mockReset().mockResolvedValue([])
})

describe('character affiliation synchronization', () => {
  test('validates one operation-bounded batch before registered ESI execution', async () => {
    await expect(processAffiliationBatch([])).rejects.toThrow('Invalid affiliation batch')
    await expect(
      processAffiliationBatch(Array.from({ length: 1_001 }, (_, index) => index + 1)),
    ).rejects.toThrow('Invalid affiliation batch')
    await expect(processAffiliationBatch([0])).rejects.toThrow('Invalid affiliation batch')
    expect(plannerMocks.executeRepresentation).not.toHaveBeenCalled()
  })

  test('propagates shared ESI cooldowns unchanged before persistence', async () => {
    const cooldown = new EsiQuotaError(45)
    plannerMocks.executeRepresentation.mockRejectedValue(cooldown)

    await expect(processAffiliationBatch([1])).rejects.toBe(cooldown)
  })

  test('honors cancellation after bulk observation and before persistence', async () => {
    const controller = new AbortController()
    const cancellation = new Error('shutdown')
    plannerMocks.executeRepresentation.mockImplementationOnce(async () => {
      controller.abort(cancellation)
      return {
        data: [{ characterId: 1, corporationId: 101, allianceId: null }],
        cachedUntil: '2026-09-12T13:00:00.000Z',
        validatedAt: '2026-09-12T12:00:00.000Z',
        source: 'esi',
        stale: false,
        quota: {},
      }
    })

    await expect(processAffiliationBatch([1], controller.signal)).rejects.toBe(cancellation)
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

    plannerMocks.selectDue.mockResolvedValueOnce([[1, 2, 3]])
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
    plannerMocks.selectDue.mockResolvedValue([[1]])

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

  test('leaves planner capacity admission and paused outcomes under producer ownership', async () => {
    const producer = createInMemoryQueueProducer({ highWaterMark: 0 })
    const outcomes = outcomeRecorder()
    plannerMocks.selectDue.mockResolvedValue([[1]])

    await expect(runAffiliationPlanner({ producer, outcomes })).resolves.toEqual({
      planned: 0,
      reason: 'planner-paused',
    })
    expect(producer.commands).toEqual([])
    expect(outcomes.recordAffiliation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'paused', planned: 0 }),
    )
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
