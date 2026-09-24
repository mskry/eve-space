import {
  claimPendingDomainEvents,
  markDomainEventPublished,
  recordDomainEventPublishFailure,
} from '../domain-events/store.js'
import { categorizeRelayFailure, RelayPublicationError } from '../domain-events/definitions.js'
import { env } from '../env.js'
import { recordDiagnostic } from '../logging.js'
import type { QueueOutcomeRecorder } from './outcome-recorder.js'
import type { OutboxRelayOutcome } from './outcomes.js'
import type { QueueProducer } from './producer.js'

export interface OutboxRelayStore {
  claim: typeof claimPendingDomainEvents
  acknowledge: typeof markDomainEventPublished
  recordFailure: typeof recordDomainEventPublishFailure
}

interface RelayOptions {
  signal?: AbortSignal
  highWaterMark?: number
  batchSize?: number
  claimTtlMs?: number
  retryDelayMs?: number
}

export const outboxRelayStore: OutboxRelayStore = {
  acknowledge: markDomainEventPublished,
  claim: claimPendingDomainEvents,
  recordFailure: recordDomainEventPublishFailure,
}

export async function runOutboxRelayBatch(
  producer: QueueProducer,
  outcomes: QueueOutcomeRecorder,
  store: OutboxRelayStore,
  options: RelayOptions = {},
) {
  options.signal?.throwIfAborted()
  const highWaterMark = options.highWaterMark ?? env.QUEUE_HIGH_WATER_MARK
  const admission = await producer.inspectCapacity({ highWaterMark, source: 'outbox' })
  options.signal?.throwIfAborted()
  if (admission.status === 'rejected') {
    await recordRelayOutcome(outcomes, 'paused', null)
    options.signal?.throwIfAborted()
    return { admission, claimed: 0, failed: 0, published: 0 }
  }

  const remainingCapacity = Math.max(0, highWaterMark - admission.depth)
  const limit = Math.min(options.batchSize ?? env.OUTBOX_RELAY_BATCH_SIZE, remainingCapacity)
  if (limit === 0) {
    await recordRelayOutcome(outcomes, 'idle', null)
    options.signal?.throwIfAborted()
    return { admission, claimed: 0, failed: 0, published: 0 }
  }

  const claims = await store.claim({
    claimTtlMs: options.claimTtlMs ?? env.OUTBOX_RELAY_CLAIM_TTL_MS,
    limit,
  })
  options.signal?.throwIfAborted()
  const publications = await Promise.all(
    claims.map(async (claim) => {
      options.signal?.throwIfAborted()
      const eventId = claim.event.eventId
      if (!claim.valid) {
        options.signal?.throwIfAborted()
        const category = 'invalid-event' as const
        recordDiagnostic('outbox.relay.event-failed', {
          context: { eventId },
          failureCategory: category,
        })
        await store.recordFailure({
          category,
          claimToken: claim.claimToken,
          eventId,
          retryDelayMs: options.retryDelayMs ?? env.OUTBOX_RELAY_RETRY_DELAY_MS,
        })
        options.signal?.throwIfAborted()
        return { category, outcome: 'failed' as const }
      }
      try {
        const produced = await producer.enqueue(
          {
            name: 'domain-event',
            payload: { eventId },
            source: 'outbox',
          },
          { signal: options.signal },
        )
        if (produced.status === 'rejected') {
          throw new RelayPublicationError('queue-rejected')
        }
        const acknowledged = await store.acknowledge(eventId, claim.claimToken)
        options.signal?.throwIfAborted()
        if (!acknowledged) {
          throw new RelayPublicationError('unknown')
        }
        recordDiagnostic('outbox.relay.event-published', {
          context: {
            eventId,
            eventType: claim.event.eventType,
            payloadVersion: claim.event.payloadVersion,
          },
        })
        return { category: null, outcome: 'published' as const }
      } catch (error) {
        options.signal?.throwIfAborted()
        const category = categorizeRelayFailure(error)
        recordDiagnostic('outbox.relay.event-failed', {
          context: {
            eventId,
            eventType: claim.event.eventType,
            payloadVersion: claim.event.payloadVersion,
          },
          error,
          failureCategory: category,
        })
        await store.recordFailure({
          category,
          claimToken: claim.claimToken,
          eventId,
          retryDelayMs: options.retryDelayMs ?? env.OUTBOX_RELAY_RETRY_DELAY_MS,
        })
        options.signal?.throwIfAborted()
        return { category, outcome: 'failed' as const }
      }
    }),
  )
  options.signal?.throwIfAborted()
  const published = publications.filter((result) => result.outcome === 'published').length
  const failed = publications.length - published
  const category = publications.find((result) => result.category)?.category ?? null
  let relayOutcome: 'idle' | 'published' | 'failed' | 'partial-failure'
  if (failed === 0) {
    relayOutcome = published === 0 ? 'idle' : 'published'
  } else {
    relayOutcome = published === 0 ? 'failed' : 'partial-failure'
  }
  await recordRelayOutcome(outcomes, relayOutcome, category)
  options.signal?.throwIfAborted()

  return { admission, claimed: claims.length, failed, published }
}

async function recordRelayOutcome(
  recorder: QueueOutcomeRecorder,
  outcome: OutboxRelayOutcome['outcome'],
  category: OutboxRelayOutcome['category'],
) {
  const value: OutboxRelayOutcome = {
    category,
    outcome,
    recordedAt: new Date().toISOString(),
  }
  await recorder.recordOutbox(value)
}
