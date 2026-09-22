import type { Questions } from '@typesafe-ai/sdk'

export const domainEventPolicy = {
  deterministic_boundary:
    'Code remains responsible for transactionality, registry membership, payload schema validation, aggregate type checks, forbidden sensitive field names, and declared idempotency strategies. This review judges semantic agreement among those exact artifacts.',
  meaning:
    'An event describes committed state, not an attempted command or a future intention. Its type, aggregate, payload, and schema must accurately describe the material database mutation surrounding the append.',
  convergence:
    'A payload carries enough stable identity and version context for consumers to converge from current PostgreSQL state. It should not require mutable display text or incidental snapshots as identity.',
  delivery:
    'Domain-event relay and execution are at-least-once. Every consumer must either persist by event ID or safely converge from current state when the same event is delivered repeatedly.',
  sensitivity:
    'Payloads contain only fields needed for recovery and convergence. Tokens, credentials, session values, encryption material, secrets, and unnecessary private evidence never belong in domain events.',
  outcome:
    'High-confidence semantic or security defects are reportable. Missing evidence, ambiguity, and low-confidence judgments require human review.',
} as const

export const domainEventQuestions = {
  mutation_fit: {
    type: 'choice',
    instructions:
      'Compare the committed mutation in `producer.mutation_context` with the emitted type, aggregate, and payload in `producer.append_call`. Does the event accurately describe the state change that this transaction accepts?',
    criteria: {
      aligned:
        'The event describes the material committed transition and does not claim a transition that the surrounding mutation did not make.',
      misleading:
        'The event names the wrong transition or subject, describes intent rather than committed state, or omits a material distinction that changes its meaning.',
      unclear: 'The supplied mutation context does not establish what state was committed.',
    },
  },
  schema_fit: {
    type: 'choice',
    instructions:
      'Compare `definition.registry_entry`, `definition.payload_schema`, and `producer.append_call`. Does the registered schema constrain the event meaning represented by this producer?',
    criteria: {
      aligned:
        'The aggregate type, payload version, schema fields, and producer payload describe the same event semantics. An identity-only trigger payload is aligned when consumers intentionally converge the current authoritative state instead of replaying a snapshot.',
      mismatch:
        'The schema accepts or requires a materially different subject, transition, or payload meaning from what the producer emits. Do not call an identity-only convergence trigger a mismatch merely because it omits the new state snapshot.',
      overbroad:
        'The schema permits materially ambiguous or unrelated payload states even though the producer intent is narrower.',
      unclear: 'The registered definition or producer payload is missing or insufficient.',
    },
  },
  identity_fit: {
    type: 'choice',
    instructions:
      'Considering every handler in `consumers`, does the aggregate and payload provide enough stable identity and version context to find current authoritative state and converge safely?',
    criteria: {
      complete:
        'Consumers can identify the affected durable subject and applicable organization or lifecycle version without relying on mutable labels or guesses.',
      incomplete:
        'A consumer lacks stable subject identity or version context needed to avoid updating the wrong current state.',
      excessive:
        'The payload carries snapshots or identity fields beyond what all shown consumers need for convergence.',
      not_consumed:
        'No consumer is registered for this event, so consumer convergence identity is not currently applicable.',
      unclear: 'The evidence does not establish what identity the consumers need.',
    },
  },
  delivery_safety: {
    type: 'choice',
    instructions:
      'Judge the handlers in `consumers` under duplicate and retried delivery. Do their declared strategy and shown behavior actually persist by event ID or converge from current state without duplicating effects?',
    criteria: {
      safe: 'Every shown consumer persists by event ID or recomputes/converges authoritative current state without additive duplicate effects.',
      unsafe:
        'A repeated delivery can duplicate a non-idempotent write, notification, grant, audit row, counter, or other occurrence-based effect.',
      not_consumed: 'No consumer is registered for this event.',
      unclear:
        'The handler delegates behavior whose duplicate-delivery safety is not established by the evidence.',
    },
  },
  sensitivity_fit: {
    type: 'choice',
    instructions:
      'Does the aggregate and payload in `producer.append_call`, as constrained by `definition.payload_schema`, contain only fields needed for recovery or consumer convergence under `policy.sensitivity`?',
    criteria: {
      minimal:
        'The payload contains only necessary stable identity, version, transition, or bounded recovery fields.',
      unnecessary_sensitive:
        'The payload includes private evidence, personal detail, or a sensitive snapshot that consumers do not need.',
      secret_like:
        'The payload appears to include credential, token, session, encryption, or secret material even if its field name evades deterministic forbidden-name checks.',
      excessive:
        'The payload contains unnecessary non-sensitive snapshot or display fields that increase retention and coupling.',
      unclear: 'The evidence does not establish why one or more payload fields are needed.',
    },
  },
} as const satisfies Questions
