import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runOutboxRelayBatch } from '../../src/queue/outbox-relay.js'

const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'
const claimToken = 'b7e7be31-3547-48aa-baaa-9b86e89e4420'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('outbox relay batch', () => {
  test('caps claims to remaining queue capacity and acknowledges stable event jobs', async () => {
    const subject = queue({ waiting: 7 })
    const dependencies = relayDependencies()

    await expect(
      runOutboxRelayBatch(subject as never, { highWaterMark: 10, batchSize: 100 }, dependencies),
    ).resolves.toMatchObject({ claimed: 1, published: 1, failed: 0 })
    expect(dependencies.claim).toHaveBeenCalledWith({ limit: 3, claimTtlMs: 30_000 })
    expect(subject.add).toHaveBeenCalledWith(
      'domain-event',
      { eventId },
      expect.objectContaining({ jobId: `domain-event-${eventId}`, attempts: 5 }),
    )
    expect(dependencies.acknowledge).toHaveBeenCalledWith(eventId, claimToken)
    expect(console.info).toHaveBeenCalledWith('Outbox relay event published', {
      eventId,
      eventType: 'character.attached',
      payloadVersion: 1,
    })
    expect(latestOutcome(subject)).toMatchObject({ outcome: 'published', category: null })
  })

  test('does not claim PostgreSQL rows while outbox admission is paused', async () => {
    const subject = queue({ waiting: 10 })
    const dependencies = relayDependencies()

    await expect(
      runOutboxRelayBatch(subject as never, { highWaterMark: 10 }, dependencies),
    ).resolves.toMatchObject({
      admission: { reason: 'outbox-paused' },
      claimed: 0,
    })
    expect(dependencies.claim).not.toHaveBeenCalled()
    expect(subject.add).not.toHaveBeenCalled()
    expect(latestOutcome(subject)).toMatchObject({ outcome: 'paused', category: null })
  })

  test('records a sanitized retry category when enqueue fails', async () => {
    const subject = queue()
    subject.add.mockRejectedValue({ code: 'ECONNRESET', message: 'redis://private-host' })
    const dependencies = relayDependencies()

    await expect(
      runOutboxRelayBatch(subject as never, { retryDelayMs: 12_000 }, dependencies),
    ).resolves.toMatchObject({ claimed: 1, published: 0, failed: 1 })
    expect(dependencies.recordFailure).toHaveBeenCalledWith({
      eventId,
      claimToken,
      category: 'queue-unavailable',
      retryDelayMs: 12_000,
    })
    expect(JSON.stringify(dependencies.recordFailure.mock.calls)).not.toContain('private-host')
    expect(console.error).toHaveBeenCalledWith('Outbox relay event failed', {
      eventId,
      eventType: 'character.attached',
      payloadVersion: 1,
      category: 'queue-unavailable',
    })
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-host')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('Payload Pilot')
    expect(latestOutcome(subject)).toMatchObject({
      outcome: 'failed',
      category: 'queue-unavailable',
    })
  })

  test('isolates an invalid stored event while publishing valid companions', async () => {
    const invalidEventId = '16b7570c-f6ea-43c5-9669-4692245b6667'
    const invalidClaimToken = '39eb48bb-50b2-4871-b944-72781b334e2e'
    const subject = queue()
    const dependencies = relayDependencies()
    dependencies.claim.mockResolvedValue([
      {
        valid: false,
        event: { eventId: invalidEventId },
        claimToken: invalidClaimToken,
        claimExpiresAt: new Date(Date.now() + 30_000),
        publishAttempts: 1,
      },
      validClaim(),
    ])

    await expect(runOutboxRelayBatch(subject as never, {}, dependencies)).resolves.toMatchObject({
      claimed: 2,
      published: 1,
      failed: 1,
    })
    expect(subject.add).toHaveBeenCalledOnce()
    expect(dependencies.recordFailure).toHaveBeenCalledWith({
      eventId: invalidEventId,
      claimToken: invalidClaimToken,
      category: 'invalid-event',
      retryDelayMs: 10_000,
    })
    expect(console.error).toHaveBeenCalledWith('Outbox relay event failed', {
      eventId: invalidEventId,
      category: 'invalid-event',
    })
    expect(latestOutcome(subject)).toMatchObject({
      outcome: 'partial-failure',
      category: 'invalid-event',
    })
  })

  test('releases enqueue-success acknowledgement failures for deterministic retry', async () => {
    const subject = queue()
    const dependencies = relayDependencies()
    dependencies.acknowledge.mockRejectedValue(new Error('database topology'))

    await expect(runOutboxRelayBatch(subject as never, {}, dependencies)).resolves.toMatchObject({
      claimed: 1,
      published: 0,
      failed: 1,
    })
    expect(subject.add).toHaveBeenCalledOnce()
    expect(dependencies.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'unknown' }),
    )
  })

  test('leaves the expiring claim authoritative if retry recording also fails', async () => {
    const subject = queue()
    subject.add.mockRejectedValue(new Error('queue failure'))
    const dependencies = relayDependencies()
    dependencies.recordFailure.mockRejectedValue(new Error('database failure'))

    await expect(runOutboxRelayBatch(subject as never, {}, dependencies)).rejects.toThrow(
      'database failure',
    )
  })

  test('records an idle outcome when no PostgreSQL events are pending', async () => {
    const subject = queue()
    const dependencies = relayDependencies()
    dependencies.claim.mockResolvedValue([])

    await expect(runOutboxRelayBatch(subject as never, {}, dependencies)).resolves.toMatchObject({
      claimed: 0,
      published: 0,
      failed: 0,
    })
    expect(latestOutcome(subject)).toMatchObject({ outcome: 'idle', category: null })
  })
})

function queue({ waiting = 0, delayed = 0 } = {}) {
  const client = { del: vi.fn(), set: vi.fn() }
  return {
    client,
    add: vi.fn().mockResolvedValue({ id: `domain-event-${eventId}` }),
    getJobCounts: vi.fn().mockResolvedValue({ waiting, delayed }),
    getBackend: () => ({ client: Promise.resolve(client) }),
  }
}

function relayDependencies() {
  return {
    claim: vi.fn().mockResolvedValue([validClaim()]),
    acknowledge: vi.fn().mockResolvedValue(true),
    recordFailure: vi.fn().mockResolvedValue(true),
  }
}

function validClaim() {
  return {
    valid: true,
    event: {
      eventId,
      eventType: 'character.attached',
      payloadVersion: 1,
      payload: { characterName: 'Payload Pilot' },
    },
    claimToken,
    claimExpiresAt: new Date(Date.now() + 30_000),
    publishAttempts: 1,
  }
}

function latestOutcome(subject: ReturnType<typeof queue>) {
  const call = subject.client.set.mock.calls.find(([key]) =>
    String(key).endsWith(':outbox-relay:outcome'),
  )
  return call ? JSON.parse(String(call[1])) : null
}
