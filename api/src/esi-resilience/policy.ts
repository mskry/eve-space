/**
 * Defaults derived from ESI's documented behaviour rather than from this deployment's capacity.
 * They are shared by every ESI caller so a protocol change lands in one place; anything that scales
 * with the host (cache sizes, timeouts) belongs in `env.ts` instead.
 */

/** Applied when a 429 or an exhausted error budget arrives without a usable reset hint. */
export const esiCooldownFallbackSeconds = 60

/** ESI's error budget is per-window; at or below this many remaining errors we back off. */
export const esiErrorBudgetFloor = 10
