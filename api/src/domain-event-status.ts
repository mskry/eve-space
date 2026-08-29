import { getPendingDomainEventAggregates } from './domain-event-store.js'
import { env } from './env.js'
import type { QueueStatus } from './queue/status.js'

export interface DomainEventStatus {
  status: 'operational' | 'degraded' | 'unavailable'
  pendingCount: number | null
  oldestPendingAgeSeconds: number | null
  relayPaused: boolean
  latestRelayOutcome: QueueStatus['latestOutboxRelayOutcome']
}

type PendingAggregateProbe = typeof getPendingDomainEventAggregates
type RelayFacts = Pick<QueueStatus, 'status' | 'outboxRelayPaused' | 'latestOutboxRelayOutcome'>

export async function probeDomainEventStatus(
  relayFacts: RelayFacts,
  aggregateProbe: PendingAggregateProbe = getPendingDomainEventAggregates,
  now = Date.now(),
): Promise<DomainEventStatus> {
  try {
    const aggregate = await aggregateProbe()
    const oldestPendingAgeSeconds = aggregate.oldestPendingAt
      ? Math.max(0, Math.floor((now - aggregate.oldestPendingAt.getTime()) / 1_000))
      : null
    const lagged = (oldestPendingAgeSeconds ?? 0) > env.OUTBOX_LAG_DEGRADED_SECONDS
    const failedOutcome =
      relayFacts.latestOutboxRelayOutcome?.outcome === 'failed' ||
      relayFacts.latestOutboxRelayOutcome?.outcome === 'partial-failure'

    let status: DomainEventStatus['status'] = 'operational'
    if (relayFacts.status === 'unavailable') status = 'unavailable'
    else if (lagged || relayFacts.outboxRelayPaused || failedOutcome) status = 'degraded'
    return {
      status,
      pendingCount: aggregate.pendingCount,
      oldestPendingAgeSeconds,
      relayPaused: relayFacts.outboxRelayPaused,
      latestRelayOutcome: relayFacts.latestOutboxRelayOutcome,
    }
  } catch {
    return {
      status: 'unavailable',
      pendingCount: null,
      oldestPendingAgeSeconds: null,
      relayPaused: relayFacts.outboxRelayPaused,
      latestRelayOutcome: relayFacts.latestOutboxRelayOutcome,
    }
  }
}
