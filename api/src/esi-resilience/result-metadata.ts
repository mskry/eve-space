import type { EsiCachedResult, EsiResultMetadata } from './types.js'

export function toEsiResultMetadata(result: EsiCachedResult<unknown>): EsiResultMetadata {
  return {
    cachedUntil: result.cachedUntil,
    validatedAt: result.validatedAt,
    stale: result.stale,
    ...(result.refreshFailureClass ? { refreshFailureClass: result.refreshFailureClass } : {}),
  }
}

export function combineEsiResultMetadata(results: readonly EsiResultMetadata[]): EsiResultMetadata {
  if (results.length === 0) throw new Error('At least one ESI result is required')

  const oldest = results.reduce((current, result) =>
    result.validatedAt < current.validatedAt ? result : current,
  )
  const earliestExpiry = results.reduce((current, result) =>
    result.cachedUntil < current.cachedUntil ? result : current,
  )
  const oldestStale = results
    .filter((result) => result.stale)
    .reduce<EsiResultMetadata | undefined>(
      (current, result) =>
        !current || result.validatedAt < current.validatedAt ? result : current,
      undefined,
    )

  return {
    cachedUntil: earliestExpiry.cachedUntil,
    validatedAt: oldest.validatedAt,
    stale: oldestStale !== undefined,
    ...(oldestStale?.refreshFailureClass
      ? { refreshFailureClass: oldestStale.refreshFailureClass }
      : {}),
  }
}
