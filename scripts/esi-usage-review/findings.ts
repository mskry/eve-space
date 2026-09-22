import type { EsiUsageJudgment, EsiUsageState } from './judgments.js'
import type { JevReviewFinding, JevReviewVerdict } from '../jev/review.js'

const AUTO_REPORT_CONFIDENCE = 0.9

export interface EsiUsageFinding extends JevReviewFinding {
  readonly site: string
  readonly operation: string
  readonly signals: EsiUsageJudgment
}

interface Concern {
  readonly label: string
  readonly choice: string
  readonly confidence: number
  readonly severe: boolean
}

export function classifyEsiUsage(
  state: EsiUsageState,
  judgment: EsiUsageJudgment,
): EsiUsageFinding {
  const concerns = concernsIn(state, judgment)
  const reportable = concerns.filter(
    (item) => item.severe && item.confidence >= AUTO_REPORT_CONFIDENCE,
  )
  let verdict: JevReviewVerdict = 'pass'
  if (reportable.length > 0) verdict = 'report'
  else if (concerns.length > 0) verdict = 'review'

  return {
    verdict,
    location: `${state.site.file}:${state.site.line} (${state.site.operation})`,
    site: `${state.site.file}:${state.site.line}`,
    operation: state.site.operation,
    reason: reasonFor(verdict, concerns),
    signals: judgment,
  }
}

function concernsIn(state: EsiUsageState, judgment: EsiUsageJudgment): Concern[] {
  const uncached = state.catalog.cacheKind === 'none'
  const cacheConcern = uncached
    ? null
    : concern('cache', judgment.cacheFit, ['unsafe'], ['questionable'])
  const versionConcern = uncached ? null : concern('version', judgment.versionFit, ['bump_missing'])
  return [
    concern('operation', judgment.operationFit, ['mismatch']),
    concern('identity', judgment.identityFit, ['incomplete']),
    cacheConcern,
    versionConcern,
  ].filter((value): value is Concern => value !== null)
}

function concern(
  label: string,
  judgment: { readonly choice: string; readonly confidence: number },
  severeChoices: readonly string[],
  reviewChoices: readonly string[] = [],
): Concern | null {
  if (severeChoices.includes(judgment.choice))
    return { label, choice: judgment.choice, confidence: judgment.confidence, severe: true }
  if (reviewChoices.includes(judgment.choice) || judgment.choice === 'unclear')
    return { label, choice: judgment.choice, confidence: judgment.confidence, severe: false }
  return null
}

function reasonFor(verdict: JevReviewVerdict, concerns: readonly Concern[]) {
  if (verdict === 'pass') return 'Operation, identity, cache, and version fit.'
  const details = concerns.map(
    ({ label, choice, confidence }) => `${label}=${choice} (${confidence.toFixed(2)})`,
  )
  return details.join('; ')
}
