import type { ChoiceResponse, EntryType } from '@typesafe-ai/sdk'
import { evaluateSystemOne, type JevClient } from '../jev/client.js'
import { domainEventPolicy, domainEventQuestions } from '../jev/policies/domain-events.js'
import type { DomainEventEvidence } from './evidence.js'

export interface DomainEventChoiceJudgment {
  readonly choice: string
  readonly confidence: number
}

export interface DomainEventJudgment {
  readonly mutationFit: DomainEventChoiceJudgment
  readonly schemaFit: DomainEventChoiceJudgment
  readonly identityFit: DomainEventChoiceJudgment
  readonly deliverySafety: DomainEventChoiceJudgment
  readonly sensitivityFit: DomainEventChoiceJudgment
}

export async function judgeDomainEvent(
  client: JevClient,
  evidence: DomainEventEvidence,
): Promise<DomainEventJudgment> {
  const answers = await evaluateSystemOne(client, toModelState(evidence), domainEventQuestions)
  return {
    deliverySafety: choice(answers.delivery_safety),
    identityFit: choice(answers.identity_fit),
    mutationFit: choice(answers.mutation_fit),
    schemaFit: choice(answers.schema_fit),
    sensitivityFit: choice(answers.sensitivity_fit),
  }
}

function toModelState(evidence: DomainEventEvidence): EntryType {
  return {
    consumers:
      evidence.consumers.length > 0
        ? evidence.consumers.map((consumer) => ({
            source: `${consumer.file}:${consumer.line}`,
            function: consumer.functionName,
            declared_idempotency:
              consumer.idempotency ?? 'No idempotency strategy was found in this handler.',
            implementation: consumer.code,
            dependency_files: [...consumer.dependencyFiles],
            dependency_sources: consumer.dependencies.map((dependency) => ({
              source: dependency.file,
              symbol: dependency.symbol,
              implementation:
                dependency.code ?? 'The imported dependency declaration was not resolved.',
            })),
          }))
        : 'No consuming handler is registered for this event.',
    definition: evidence.definition
      ? {
          aggregate_type: evidence.definition.aggregateType,
          payload_version: evidence.definition.payloadVersion,
          registry_entry: evidence.definition.registryEntry,
          payload_schema:
            evidence.definition.payloadSchema ?? 'No payload schema declaration was resolved.',
        }
      : 'No matching registered domain-event definition was found.',
    policy: domainEventPolicy,
    producer: {
      aggregate_id: evidence.producer.aggregateId ?? 'No aggregate ID expression was found.',
      append_call: evidence.producer.appendCall,
      event_type_expression: evidence.producer.eventTypeExpression,
      function: evidence.producer.functionName ?? 'No enclosing named function was found.',
      mutation_context: evidence.producer.mutationContext,
      payload: evidence.producer.payload ?? 'No payload expression was found.',
      payload_version: evidence.producer.payloadVersion,
      resolved_event_type: evidence.producer.eventType,
      source: `${evidence.producer.file}:${evidence.producer.line}`,
    },
  }
}

function choice(answer: ChoiceResponse): DomainEventChoiceJudgment {
  return { choice: answer.choice, confidence: answer.confidence }
}
