import type { CoordinationRedisConnection } from '../coordination-redis.js'
import { affiliationPlannerOutcomeKey, outboxRelayOutcomeKey } from './namespaces.js'
import {
  encodeAffiliationPlannerOutcome,
  encodeOutboxRelayOutcome,
  type AffiliationPlannerOutcome,
  type OutboxRelayOutcome,
} from './outcomes.js'

export interface QueueOutcomeRecorder {
  recordAffiliation(outcome: AffiliationPlannerOutcome): Promise<void>
  recordOutbox(outcome: OutboxRelayOutcome): Promise<void>
}

export function createQueueOutcomeRecorder(
  connection: CoordinationRedisConnection,
): QueueOutcomeRecorder {
  return {
    async recordAffiliation(outcome) {
      await connection.set(affiliationPlannerOutcomeKey, encodeAffiliationPlannerOutcome(outcome))
    },
    async recordOutbox(outcome) {
      await connection.set(outboxRelayOutcomeKey, encodeOutboxRelayOutcome(outcome))
    },
  }
}
