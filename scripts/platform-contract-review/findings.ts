import type { JevReviewFinding, JevReviewVerdict } from '../jev/review.js'
import type { PlatformContractEvidence } from './evidence.js'
import type { ChoiceJudgment, PlatformContractJudgment } from './judgments.js'

const AUTO_REPORT_CONFIDENCE = 0.9
const MINIMUM_PASS_CONFIDENCE = 0.5

export interface PlatformContractFinding extends JevReviewFinding {
  readonly routeId: string
  readonly signals: PlatformContractJudgment
}

interface Concern {
  readonly label: string
  readonly choice: string
  readonly confidence: number
  readonly severe: boolean
}

export function classifyPlatformContract(
  evidence: PlatformContractEvidence,
  judgment: PlatformContractJudgment,
): PlatformContractFinding {
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
  return {
    details: implementationDetails(evidence),
    location: `${evidence.manifestFile}:${evidence.manifestLine} (${evidence.id})`,
    reason: reasonFor(verdict, concerns),
    routeId: evidence.route.id,
    signals: judgment,
    verdict,
  }
}

function concernsIn(judgment: PlatformContractJudgment) {
  return [
    concern('purpose', judgment.purposeFit, ['mismatch']),
    concern('audience', judgment.audienceFit, ['overbroad']),
    concern('permission', judgment.permissionFit, ['under_scoped', 'mismatch']),
    concern('target', judgment.targetFit, ['mismatch']),
    concern('sensitivity', judgment.sensitivityFit, ['underclassified'], ['inconsistent']),
  ].filter((value): value is Concern => value !== null)
}

function concern(
  label: string,
  judgment: ChoiceJudgment,
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

function implementationDetails(evidence: PlatformContractEvidence) {
  if (!evidence.implementation.file || !evidence.implementation.line) {
    return ['implementation: not found']
  }
  return [`implementation: ${evidence.implementation.file}:${evidence.implementation.line}`]
}

function reasonFor(verdict: JevReviewVerdict, concerns: readonly Concern[]) {
  if (verdict === 'pass') {
    return 'Purpose, audience, permission, target, and sensitivity are semantically aligned.'
  }
  return concerns
    .map(({ label, choice, confidence }) => `${label}=${choice} (${confidence.toFixed(2)})`)
    .join('; ')
}
