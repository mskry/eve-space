import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runOutboxRelayBatch } from '../../src/queue/outbox-relay.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'
import { apiLogger } from '../../src/logging.js'

const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'
const claimToken = 'b7e7be31-3547-48aa-baaa-9b86e89e4420'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  apiLogger.enableLogging()
})

afterEach(() => {
  apiLogger.disableLogging()
  vi.restoreAllMocks()
})

describe('outbox relay batch', () => {
  test('caps claims to remaining capacity and acknowledges stable event commands', async () => {
    const producer = createInMemoryQueueProducer({ depth: 7 })
    const outcomes = outcomeRecorder()
    const store = relayStore()

    await expect(
      runOutboxRelayBatch(producer, outcomes, store, { batchSize: 100, highWaterMark: 10 }),
    ).resolves.toMatchObject({ claimed: 1, failed: 0, published: 1 })
    expect(store.claim).toHaveBeenCalledWith({ claimTtlMs: 30_000, limit: 3 })
    expect(producer.commands).toStrictEqual([
      { name: 'domain-event', payload: { eventId }, source: 'outbox' },
    ])
    expect(store.acknowledge).toHaveBeenCalledWith(eventId, claimToken)
    expect(JSON.parse(String(vi.mocked(console.info).mock.calls[0]?.[0]))).toStrictEqual(
      expect.objectContaining({
        event: 'outbox.relay.event-published',
        eventId,
        eventType: 'character.attached',
        payloadVersion: 1,
      }),
    )
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('Payload Pilot')
    expect(outcomes.recordOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ category: null, outcome: 'published' }),
    )
  })

  test('does not claim PostgreSQL rows while outbox admission is paused', async () => {
    const producer = createInMemoryQueueProducer({ depth: 10, highWaterMark: 10 })
    const outcomes = outcomeRecorder()
    const store = relayStore()

    await expect(
      runOutboxRelayBatch(producer, outcomes, store, { highWaterMark: 10 }),
    ).resolves.toMatchObject({
      admission: { reason: 'outbox-paused', status: 'rejected' },
      claimed: 0,
    })
    expect(store.claim).not.toHaveBeenCalled()
    expect(outcomes.recordOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'paused' }),
    )
  })

  test('records a sanitized retry category when infrastructure enqueue fails', async () => {
    const producer = createInMemoryQueueProducer()
    producer.enqueue = vi.fn().mockRejectedValue({
      code: 'ECONNRESET',
      message: 'redis://private-host',
    })
    const outcomes = outcomeRecorder()
    const store = relayStore()

    await expect(
      runOutboxRelayBatch(producer, outcomes, store, { retryDelayMs: 12_000 }),
    ).resolves.toMatchObject({ claimed: 1, failed: 1, published: 0 })
    expect(store.recordFailure).toHaveBeenCalledWith({
      category: 'queue-unavailable',
      claimToken,
      eventId,
      retryDelayMs: 12_000,
    })
    expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0]))).toStrictEqual(
      expect.objectContaining({
        event: 'outbox.relay.event-failed',
        eventId,
        eventType: 'character.attached',
        failureCategory: 'queue-unavailable',
        payloadVersion: 1,
      }),
    )
    const serializedLogs = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(serializedLogs).not.toContain('private-host')
    expect(serializedLogs).not.toContain('Payload Pilot')
  })

  test('does not record publication failure when enqueue is cancelled', async () => {
    const controller = new AbortController()
    const producer = createInMemoryQueueProducer()
    producer.enqueue = vi.fn().mockImplementation(async () => {
      controller.abort()
      throw controller.signal.reason
    })
    const outcomes = outcomeRecorder()
    const store = relayStore()

    const pending = runOutboxRelayBatch(producer, outcomes, store, { signal: controller.signal })
    const rejected = pending.catch((error: unknown) => error)
    await vi.waitFor(() => expect(controller.signal.aborted).toBe(true))

    await expect(rejected).resolves.toBe(controller.signal.reason)
    expect(store.recordFailure).not.toHaveBeenCalled()
    expect(outcomes.recordOutbox).not.toHaveBeenCalled()
  })

  test('turns expected producer rejection into recoverable queue rejection', async () => {
    const producer = createInMemoryQueueProducer()
    producer.enqueue = vi.fn().mockResolvedValue({
      depth: 1,
      reason: 'coalesced',
      status: 'rejected',
    })
    const store = relayStore()

    await runOutboxRelayBatch(producer, outcomeRecorder(), store)

    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'queue-rejected' }),
    )
    expect(store.acknowledge).not.toHaveBeenCalled()
  })

  test('isolates invalid stored events while publishing valid companions', async () => {
    const producer = createInMemoryQueueProducer()
    const outcomes = outcomeRecorder()
    const store = relayStore()
    store.claim.mockResolvedValue([
      {
        claimExpiresAt: new Date(Date.now() + 30_000),
        claimToken: '39eb48bb-50b2-4871-b944-72781b334e2e',
        event: { eventId: '16b7570c-f6ea-43c5-9669-4692245b6667' },
        publishAttempts: 1,
        valid: false,
      },
      validClaim(),
    ])

    await expect(runOutboxRelayBatch(producer, outcomes, store)).resolves.toMatchObject({
      claimed: 2,
      failed: 1,
      published: 1,
    })
    expect(outcomes.recordOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'invalid-event', outcome: 'partial-failure' }),
    )
  })

  test.each(['rejected', 'ownership-lost'] as const)(
    'releases an accepted publication when acknowledgement is %s',
    async (failure) => {
      const producer = createInMemoryQueueProducer()
      const store = relayStore()
      if (failure === 'rejected') {
        store.acknowledge.mockRejectedValueOnce(new Error('database topology'))
      } else {
        store.acknowledge.mockResolvedValueOnce(false)
      }

      await expect(runOutboxRelayBatch(producer, outcomeRecorder(), store)).resolves.toMatchObject({
        claimed: 1,
        failed: 1,
        published: 0,
      })
      expect(producer.commands).toHaveLength(1)
      expect(store.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'unknown', claimToken, eventId }),
      )
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('database topology')
    },
  )

  test('accounts for producer rejection within a partially published batch', async () => {
    const rejectedEventId = '16b7570c-f6ea-43c5-9669-4692245b6667'
    const rejectedClaimToken = '39eb48bb-50b2-4871-b944-72781b334e2e'
    const producer = createInMemoryQueueProducer()
    producer.enqueue = vi
      .fn()
      .mockResolvedValueOnce({ depth: 0, status: 'accepted' })
      .mockResolvedValueOnce({ depth: 1, reason: 'outbox-paused', status: 'rejected' })
    const outcomes = outcomeRecorder()
    const store = relayStore()
    store.claim.mockResolvedValue([validClaim(), validClaim(rejectedEventId, rejectedClaimToken)])

    await expect(runOutboxRelayBatch(producer, outcomes, store)).resolves.toMatchObject({
      claimed: 2,
      failed: 1,
      published: 1,
    })
    expect(store.acknowledge).toHaveBeenCalledOnce()
    expect(store.acknowledge).toHaveBeenCalledWith(eventId, claimToken)
    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'queue-rejected',
        claimToken: rejectedClaimToken,
        eventId: rejectedEventId,
      }),
    )
    expect(outcomes.recordOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'queue-rejected', outcome: 'partial-failure' }),
    )
  })

  test('records an idle outcome when no events are pending', async () => {
    const outcomes = outcomeRecorder()
    const store = relayStore()
    store.claim.mockResolvedValue([])

    await expect(
      runOutboxRelayBatch(createInMemoryQueueProducer(), outcomes, store),
    ).resolves.toMatchObject({ claimed: 0, failed: 0, published: 0 })
    expect(outcomes.recordOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ category: null, outcome: 'idle' }),
    )
  })

  test('propagates failure recording and outcome recording infrastructure errors', async () => {
    const producer = createInMemoryQueueProducer()
    producer.enqueue = vi.fn().mockRejectedValue(new Error('queue failure'))
    const store = relayStore()
    store.recordFailure.mockRejectedValue(new Error('database failure'))
    await expect(runOutboxRelayBatch(producer, outcomeRecorder(), store)).rejects.toThrow(
      'database failure',
    )

    const outcomes = outcomeRecorder()
    outcomes.recordOutbox.mockRejectedValue(new Error('outcome unavailable'))
    store.recordFailure.mockResolvedValue(true)
    store.claim.mockResolvedValue([])
    await expect(runOutboxRelayBatch(producer, outcomes, store)).rejects.toThrow(
      'outcome unavailable',
    )
  })
})

function outcomeRecorder() {
  return {
    recordAffiliation: vi.fn().mockResolvedValue(undefined),
    recordOutbox: vi.fn().mockResolvedValue(undefined),
  }
}

function relayStore() {
  return {
    acknowledge: vi.fn().mockResolvedValue(true),
    claim: vi.fn().mockResolvedValue([validClaim()]),
    recordFailure: vi.fn().mockResolvedValue(true),
  }
}

function validClaim(id = eventId, token = claimToken) {
  return {
    claimExpiresAt: new Date(Date.now() + 30_000),
    claimToken: token,
    event: {
      eventId: id,
      eventType: 'character.attached',
      payload: { characterName: 'Payload Pilot' },
      payloadVersion: 1,
    },
    publishAttempts: 1,
    valid: true,
  } as const
}
