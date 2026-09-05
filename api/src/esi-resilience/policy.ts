/**
 * Defaults derived from ESI's documented behaviour rather than from this deployment's capacity.
 * They are shared by every ESI caller so a protocol change lands in one place; anything that scales
 * with the host (cache sizes, timeouts) belongs in `env.ts` instead.
 */

/** Applied when a 429 or an exhausted error budget arrives without a usable reset hint. */
export const esiCooldownFallbackSeconds = 60

/** ESI's error budget is per-window; at or below this many remaining errors we back off. */
export const esiErrorBudgetFloor = 10

export type EsiResponseOutcome =
  | 'success'
  | 'notModified'
  | 'rateLimited'
  | 'clientError'
  | 'serverError'

/**
 * ESI charges its floating-window buckets per response class, so the class that telemetry counts
 * and the tokens a response spends are one decision and must not drift apart.
 */
export function classifyEsiResponse(status: number): {
  outcome: EsiResponseOutcome
  tokenCost: number
} {
  if (status >= 200 && status < 300) return { outcome: 'success', tokenCost: 2 }
  if (status === 304) return { outcome: 'notModified', tokenCost: 1 }
  if (status === 429) return { outcome: 'rateLimited', tokenCost: 0 }
  if (status >= 400 && status < 500) return { outcome: 'clientError', tokenCost: 5 }
  return { outcome: 'serverError', tokenCost: 0 }
}
