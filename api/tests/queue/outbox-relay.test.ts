import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runOutboxRelayBatch } from '../../src/queue/outbox-relay.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'
const claimToken = 'b7e7be31-3547-48aa-baaa-9b86e89e4420'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('outbox relay batch', () => {
  test('caps claims to remaining capacity and acknowledges stable event commands', async () => {
    const producer = createInMemoryQueueProducer({ depth: 7 })
    const outcomes = outcomeRecorder()
    const store = relayStore()

    await expect(
      runOutboxRelayBatch(producer, outcomes, store, { highWaterMark: 10, batchSize: 100 }),
    ).resolves.toMatchObject({ claimed: 1, published: 1, failed: 0 })
    expect(store.claim).toHaveBeenCalledWith({ limit: 3, claimTtlMs: 30_000 })
    expect(producer.commands).toEqual([
      { name: 'domain-event', payload: { eventId }, source: 'outbox' },
    ])
    expect(store.acknowledge).toHaveBeenCalledWith(eventId, claimToken)
    expect(console.info).toHaveBeenCalledWith('Outbox relay event published', {
      eventId,
      eventType: 'character.attached',
      payloadVersion: 1,
    })
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('Payload Pilot')
    expect(outcomes.recordOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'published', category: null }),
    )
  })

  test('does not claim PostgreSQL rows while outbox admission is paused', async () => {
    const producer = createInMemoryQueueProducer({ highWaterMark: 10, depth: 10 })
    const outcomes = outcomeRecorder()
    const store = relayStore()

    await expect(
      runOutboxRelayBatch(producer, outcomes, store, { highWaterMark: 10 }),
    ).resolves.toMatchObject({
      admission: { status: 'rejected', reason: 'outbox-paused' },
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
    ).resolves.toMatchObject({ claimed: 1, published: 0, failed: 1 })
    expect(store.recordFailure).toHaveBeenCalledWith({
      eventId,
      claimToken,
      category: 'queue-unavailable',
      retryDelayMs: 12_000,
    })
    expect(console.error).toHaveBeenCalledWith('Outbox relay event failed', {
      eventId,
      eventType: 'character.attached',
      payloadVersion: 1,
      category: 'queue-unavailable',
    })
    const serializedLogs = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(serializedLogs).not.toContain('private-host')
    expect(serializedLogs).not.toContain('Payload Pilot')
  })

  test('turns expected producer rejection into recoverable queue rejection', async () => {
    const producer = createInMemoryQueueProducer()
    producer.enqueue = vi.fn().mockResolvedValue({
      status: 'rejected',
      depth: 1,
      reason: 'coalesced',
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
        valid: false,
        event: { eventId: '16b7570c-f6ea-43c5-9669-4692245b6667' },
        claimToken: '39eb48bb-50b2-4871-b944-72781b334e2e',
        claimExpiresAt: new Date(Date.now() + 30_000),
        publishAttempts: 1,
      },
      validClaim(),
    ])

    await expect(runOutboxRelayBatch(producer, outcomes, store)).resolves.toMatchObject({
      claimed: 2,
      published: 1,
      failed: 1,
    })
    expect(outcomes.recordOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'partial-failure', category: 'invalid-event' }),
    )
  })

  test.each(['rejected', 'ownership-lost'] as const)(
    'releases an accepted publication when acknowledgement is %s',
    async (failure) => {
      const producer = createInMemoryQueueProducer()
      const store = relayStore()
      if (failure === 'rejected')
        store.acknowledge.mockRejectedValueOnce(new Error('database topology'))
      else store.acknowledge.mockResolvedValueOnce(false)

      await expect(runOutboxRelayBatch(producer, outcomeRecorder(), store)).resolves.toMatchObject({
        claimed: 1,
        published: 0,
        failed: 1,
      })
      expect(producer.commands).toHaveLength(1)
      expect(store.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ eventId, claimToken, category: 'unknown' }),
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
      .mockResolvedValueOnce({ status: 'accepted', depth: 0 })
      .mockResolvedValueOnce({ status: 'rejected', depth: 1, reason: 'outbox-paused' })
    const outcomes = outcomeRecorder()
    const store = relayStore()
    store.claim.mockResolvedValue([validClaim(), validClaim(rejectedEventId, rejectedClaimToken)])

    await expect(runOutboxRelayBatch(producer, outcomes, store)).resolves.toMatchObject({
      claimed: 2,
      published: 1,
      failed: 1,
    })
    expect(store.acknowledge).toHaveBeenCalledOnce()
    expect(store.acknowledge).toHaveBeenCalledWith(eventId, claimToken)
    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: rejectedEventId,
        claimToken: rejectedClaimToken,
        category: 'queue-rejected',
      }),
    )
    expect(outcomes.recordOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'partial-failure', category: 'queue-rejected' }),
    )
  })

  test('records an idle outcome when no events are pending', async () => {
    const outcomes = outcomeRecorder()
    const store = relayStore()
    store.claim.mockResolvedValue([])

    await expect(
      runOutboxRelayBatch(createInMemoryQueueProducer(), outcomes, store),
    ).resolves.toMatchObject({ claimed: 0, published: 0, failed: 0 })
    expect(outcomes.recordOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'idle', category: null }),
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
    claim: vi.fn().mockResolvedValue([validClaim()]),
    acknowledge: vi.fn().mockResolvedValue(true),
    recordFailure: vi.fn().mockResolvedValue(true),
  }
}

function validClaim(id = eventId, token = claimToken) {
  return {
    valid: true,
    event: {
      eventId: id,
      eventType: 'character.attached',
      payloadVersion: 1,
      payload: { characterName: 'Payload Pilot' },
    },
    claimToken: token,
    claimExpiresAt: new Date(Date.now() + 30_000),
    publishAttempts: 1,
  } as const
}
