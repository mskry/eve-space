/**
 * Defaults derived from ESI's documented behaviour rather than from this deployment's capacity.
 * They are shared by every ESI caller so a protocol change lands in one place; anything that scales
 * with the host (cache sizes, timeouts) belongs in `env.ts` instead.
 */

/** Applied when a 429 or an exhausted error budget arrives without a usable reset hint. */
export const esiCooldownFallbackSeconds = 60

/** ESI's error budget is per-window; at or below this many remaining errors we back off. */
export const esiErrorBudgetFloor = 10

/** Applied when a response carries neither `expires` nor `cache-control: max-age`. */
export const esiDefaultCacheTtlMs = 60_000

/** Public character/corporation profiles change rarely; ESI itself caches them for minutes. */
export const publicProfileCacheTtlMs = 5 * 60_000

/** The NPC corporation list is effectively static between expansions. */
export const npcCorporationCacheTtlMs = 60 * 60_000

/** Negative lookups are cached briefly so a typo cannot pin a character to a 404 for long. */
export const notFoundCacheTtlMs = 60_000
