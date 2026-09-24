import type { JevReviewFinding, JevReviewVerdict } from '../jev/review.js'
import type { DomainEventEvidence } from './evidence.js'
import type { DomainEventChoiceJudgment, DomainEventJudgment } from './judgments.js'

const AUTO_REPORT_CONFIDENCE = 0.9
const MINIMUM_PASS_CONFIDENCE = 0.5

export interface DomainEventFinding extends JevReviewFinding {
  readonly eventType: string
  readonly signals: DomainEventJudgment
}

interface Concern {
  readonly label: string
  readonly choice: string
  readonly confidence: number
  readonly severe: boolean
}

export function classifyDomainEvent(
  evidence: DomainEventEvidence,
  judgment: DomainEventJudgment,
): DomainEventFinding {
  const concerns = concernsIn(judgment)
  const reportable = concerns.some(
    (item) => item.severe && item.confidence >= AUTO_REPORT_CONFIDENCE,
  )
  let verdict: JevReviewVerdict = 'pass'
  if (reportable) {
    verdict = 'report'
  } else if (concerns.length > 0) {
    verdict = 'review'
  }
  const schema = evidence.definition
    ? `${evidence.definition.eventType} v${evidence.definition.payloadVersion}`
    : 'not found'
  return {
    details: [`schema: ${schema}`, `consumers: ${evidence.consumers.length}`],
    eventType: evidence.producer.eventType,
    location: `${evidence.producer.file}:${evidence.producer.line} (${evidence.producer.eventType})`,
    reason: reasonFor(verdict, concerns),
    signals: judgment,
    verdict,
  }
}

function concernsIn(judgment: DomainEventJudgment) {
  return [
    concern('mutation', judgment.mutationFit, ['misleading']),
    concern('schema', judgment.schemaFit, ['mismatch'], ['overbroad']),
    concern('identity', judgment.identityFit, ['incomplete'], ['excessive']),
    concern('delivery', judgment.deliverySafety, ['unsafe']),
    concern(
      'sensitivity',
      judgment.sensitivityFit,
      ['unnecessary_sensitive', 'secret_like'],
      ['excessive'],
    ),
  ].filter((value): value is Concern => value !== null)
}

function concern(
  label: string,
  judgment: DomainEventChoiceJudgment,
  severeChoices: readonly string[],
  reviewChoices: readonly string[] = [],
) {
  if (severeChoices.includes(judgment.choice)) {
    return { label, ...judgment, severe: true } satisfies Concern
  }
  if (
    reviewChoices.includes(judgment.choice) ||
    judgment.choice === 'unclear' ||
    judgment.confidence < MINIMUM_PASS_CONFIDENCE
  ) {
    return { label, ...judgment, severe: false } satisfies Concern
  }
  return null
}

function reasonFor(verdict: JevReviewVerdict, concerns: readonly Concern[]) {
  if (verdict === 'pass') {
    return 'Mutation meaning, schema, convergence identity, delivery safety, and payload sensitivity are aligned.'
  }
  return concerns
    .map(({ label, choice, confidence }) => `${label}=${choice} (${confidence.toFixed(2)})`)
    .join('; ')
}
