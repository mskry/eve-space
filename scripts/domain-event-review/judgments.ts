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
    mutationFit: choice(answers.mutation_fit),
    schemaFit: choice(answers.schema_fit),
    identityFit: choice(answers.identity_fit),
    deliverySafety: choice(answers.delivery_safety),
    sensitivityFit: choice(answers.sensitivity_fit),
  }
}

function toModelState(evidence: DomainEventEvidence): EntryType {
  return {
    producer: {
      source: `${evidence.producer.file}:${evidence.producer.line}`,
      function: evidence.producer.functionName ?? 'No enclosing named function was found.',
      resolved_event_type: evidence.producer.eventType,
      event_type_expression: evidence.producer.eventTypeExpression,
      payload_version: evidence.producer.payloadVersion,
      aggregate_id: evidence.producer.aggregateId ?? 'No aggregate ID expression was found.',
      payload: evidence.producer.payload ?? 'No payload expression was found.',
      append_call: evidence.producer.appendCall,
      mutation_context: evidence.producer.mutationContext,
    },
    definition: evidence.definition
      ? {
          aggregate_type: evidence.definition.aggregateType,
          payload_version: evidence.definition.payloadVersion,
          registry_entry: evidence.definition.registryEntry,
          payload_schema:
            evidence.definition.payloadSchema ?? 'No payload schema declaration was resolved.',
        }
      : 'No matching registered domain-event definition was found.',
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
    policy: domainEventPolicy,
  }
}

function choice(answer: ChoiceResponse): DomainEventChoiceJudgment {
  return { choice: answer.choice, confidence: answer.confidence }
}
