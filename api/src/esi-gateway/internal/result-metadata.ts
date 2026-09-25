import type { EsiResultMetadata } from './types.js'

export function combineEsiResultMetadata(results: readonly EsiResultMetadata[]): EsiResultMetadata {
  if (results.length === 0) {
    throw new Error('At least one ESI result is required')
  }

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
  let latestRetryAt: string | undefined
  let latestRetryTime = Number.NEGATIVE_INFINITY
  for (const result of results) {
    if (!result.stale || !result.retryAt) {
      continue
    }
    const retryTime = Date.parse(result.retryAt)
    if (Number.isFinite(retryTime) && retryTime > latestRetryTime) {
      latestRetryAt = result.retryAt
      latestRetryTime = retryTime
    }
  }

  return {
    cachedUntil: earliestExpiry.cachedUntil,
    stale: oldestStale !== undefined,
    validatedAt: oldest.validatedAt,
    ...(oldestStale?.refreshFailureClass && {
      refreshFailureClass: oldestStale.refreshFailureClass,
    }),
    ...(latestRetryAt && { retryAt: latestRetryAt }),
  }
}
