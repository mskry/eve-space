import type { SiteJudgment, SiteState } from './judgments.js'

// Thresholds measured against the 39 human-labelled requests in
// docs/fetching-layer-review-frontend.md; see scripts/calibrate-ssr-boundaries.ts.
// Labelled-gated requests score ssr_capable at a 0.31 median, so that answer does not
// separate a gated request from an ungated one and cannot gate a report on its own.
const NOT_SSR_CAPABLE_THRESHOLD = 0.15
const PUBLIC_EXCLUSION_THRESHOLD = 0.7
const CLAIMED_GATE_CONFIDENCE = 0.35
const AUTO_REPORT_CONFIDENCE = 0.8
const COOKIE_RELIANCE_THRESHOLD = 0.6

const CREDENTIALED_REQUIREMENTS = new Set([
  'application_session',
  'owned_character',
  'organization_permission',
  'administrator_session',
])

type FindingVerdict = 'report' | 'review' | 'pass'

export interface Finding {
  verdict: FindingVerdict
  callSite: string
  routeMount: string
  requirement: string
  reason: string
  signals: SiteJudgment
}

export const classifySite = (state: SiteState, judgment: SiteJudgment): Finding => {
  const callSite = `${state.site.file}:${state.site.line}`
  const routeMount = state.route
    ? `${state.route.method} ${state.route.path} (${state.route.source})`
    : 'unresolved route mount'
  const base = {
    callSite,
    routeMount,
    requirement: judgment.credentialRequirement.choice,
    signals: judgment,
  }
  const skip = skipReason(judgment)

  if (skip) return { ...base, verdict: 'pass', reason: skip }

  if (judgment.ssrSafePath.choice !== 'none')
    return judgment.ssrSafePath.confidence >= CLAIMED_GATE_CONFIDENCE
      ? { ...base, verdict: 'pass', reason: `Safe path present: ${judgment.ssrSafePath.choice}.` }
      : {
          ...base,
          verdict: 'review',
          reason: `Claimed safe path ${judgment.ssrSafePath.choice} is uncertain (confidence ${format(judgment.ssrSafePath.confidence)}).`,
        }

  const cookieTrap =
    judgment.credentialsIncludeOnly > COOKIE_RELIANCE_THRESHOLD
      ? " The call relies on credentials: 'include', which does not forward browser cookies from a server-side fetch."
      : ''

  return {
    ...base,
    verdict:
      CREDENTIALED_REQUIREMENTS.has(judgment.credentialRequirement.choice) &&
      judgment.credentialRequirement.confidence >= AUTO_REPORT_CONFIDENCE
        ? 'report'
        : 'review',
    reason: `Request reaches a route requiring ${judgment.credentialRequirement.choice} with no SSR gate or cookie forwarding (ssr_capable ${format(judgment.ssrCapable)}).${cookieTrap}`,
  }
}

export const formatReport = (findings: readonly Finding[]) => {
  const reportable = findings.filter((finding) => finding.verdict !== 'pass')

  if (reportable.length === 0)
    return `No SSR boundary findings across ${findings.length} reviewed request site(s).`

  return reportable
    .map(
      (finding) =>
        `[${finding.verdict.toUpperCase()}] ${finding.callSite}\n  route: ${finding.routeMount}\n  ${finding.reason}`,
    )
    .join('\n\n')
}

const skipReason = (judgment: SiteJudgment) => {
  if (judgment.excludedPublicEndpoint > PUBLIC_EXCLUSION_THRESHOLD)
    return 'Health, status, or authorization-configuration endpoint.'

  if (judgment.ssrCapable < NOT_SSR_CAPABLE_THRESHOLD)
    return 'Cannot execute during SSR (browser-event path).'

  if (
    judgment.credentialRequirement.choice === 'public' &&
    judgment.credentialRequirement.confidence >= AUTO_REPORT_CONFIDENCE
  )
    return 'Mounted route is public.'

  return null
}

const format = (value: number) => value.toFixed(2)
