import type { Queue } from 'bullmq'
import {
  claimPendingDomainEvents,
  markDomainEventPublished,
  recordDomainEventPublishFailure,
} from '../domain-event-store.js'
import { categorizeRelayFailure, RelayPublicationError } from '../domain-events.js'
import { env } from '../env.js'
import { admitQueueWork } from './admission.js'
import {
  domainEventJobId,
  getJobDefinition,
  jobOptions,
  type JobDefinition,
} from './job-registry.js'
import { outboxRelayOutcomeKey } from './namespaces.js'
import type { OutboxRelayOutcome } from './status.js'

interface RelayDependencies {
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

const defaultDependencies: RelayDependencies = {
  claim: claimPendingDomainEvents,
  acknowledge: markDomainEventPublished,
  recordFailure: recordDomainEventPublishFailure,
}

export async function runOutboxRelayBatch(
  queue: Queue,
  options: RelayOptions = {},
  dependencies: RelayDependencies = defaultDependencies,
) {
  options.signal?.throwIfAborted()
  const highWaterMark = options.highWaterMark ?? env.QUEUE_HIGH_WATER_MARK
  const admission = await admitQueueWork(queue, 'domain-event', 'outbox', highWaterMark)
  if (!admission.admitted) {
    await recordRelayOutcome(queue, 'paused', null)
    return { admission, claimed: 0, published: 0, failed: 0 }
  }

  const remainingCapacity = Math.max(0, highWaterMark - admission.depth)
  const limit = Math.min(options.batchSize ?? env.OUTBOX_RELAY_BATCH_SIZE, remainingCapacity)
  if (limit === 0) {
    await recordRelayOutcome(queue, 'idle', null)
    return { admission, claimed: 0, published: 0, failed: 0 }
  }

  const claims = await dependencies.claim({
    limit,
    claimTtlMs: options.claimTtlMs ?? env.OUTBOX_RELAY_CLAIM_TTL_MS,
  })
  const definition = getJobDefinition('domain-event') as JobDefinition<{ eventId: string }>
  const outcomes = await Promise.all(
    claims.map(async (claim) => {
      options.signal?.throwIfAborted()
      const eventId = claim.event.eventId
      if (!claim.valid) {
        const category = 'invalid-event' as const
        console.error('Outbox relay event failed', { eventId, category })
        await dependencies.recordFailure({
          eventId,
          claimToken: claim.claimToken,
          category,
          retryDelayMs: options.retryDelayMs ?? env.OUTBOX_RELAY_RETRY_DELAY_MS,
        })
        return { outcome: 'failed' as const, category }
      }
      try {
        await queue.add(
          definition.name,
          { eventId },
          jobOptions(definition, domainEventJobId(eventId)),
        )
        const acknowledged = await dependencies.acknowledge(eventId, claim.claimToken)
        if (!acknowledged) throw new RelayPublicationError('unknown')
        console.info('Outbox relay event published', {
          eventId,
          eventType: claim.event.eventType,
          payloadVersion: claim.event.payloadVersion,
        })
        return { outcome: 'published' as const, category: null }
      } catch (error) {
        const category = categorizeRelayFailure(error)
        console.error('Outbox relay event failed', {
          eventId,
          eventType: claim.event.eventType,
          payloadVersion: claim.event.payloadVersion,
          category,
        })
        await dependencies.recordFailure({
          eventId,
          claimToken: claim.claimToken,
          category,
          retryDelayMs: options.retryDelayMs ?? env.OUTBOX_RELAY_RETRY_DELAY_MS,
        })
        return { outcome: 'failed' as const, category }
      }
    }),
  )
  const published = outcomes.filter((result) => result.outcome === 'published').length
  const failed = outcomes.length - published
  const category = outcomes.find((result) => result.category)?.category ?? null
  let relayOutcome: 'idle' | 'published' | 'failed' | 'partial-failure'
  if (failed === 0) relayOutcome = published === 0 ? 'idle' : 'published'
  else relayOutcome = published === 0 ? 'failed' : 'partial-failure'
  await recordRelayOutcome(queue, relayOutcome, category)

  return { admission, claimed: claims.length, published, failed }
}

async function recordRelayOutcome(
  queue: Queue,
  outcome: OutboxRelayOutcome['outcome'],
  category: OutboxRelayOutcome['category'],
) {
  const value: OutboxRelayOutcome = {
    outcome,
    category,
    recordedAt: new Date().toISOString(),
  }
  await queue
    .getBackend()
    .client.then((connection) => connection.set(outboxRelayOutcomeKey, JSON.stringify(value)))
}
