export function projectManagedCorporationEvidence(
  state:
    | {
        validatedAt: Date | null
        nextEligibleAt: Date | null
        lastFailureClass: string | null
        failureStartedAt: Date | null
      }
    | undefined,
  now: Date,
) {
  if (!state?.validatedAt)
    return {
      freshness: 'unavailable' as const,
      evidenceAt: null,
      freshUntil: null,
      staleSince: state?.failureStartedAt ?? null,
    }
  if (
    state.lastFailureClass ||
    !state.nextEligibleAt ||
    state.nextEligibleAt.getTime() <= now.getTime()
  )
    return {
      freshness: 'stale' as const,
      evidenceAt: state.validatedAt,
      freshUntil: null,
      staleSince: state.lastFailureClass
        ? (state.failureStartedAt ?? state.validatedAt)
        : (state.nextEligibleAt ?? state.validatedAt),
    }
  return {
    freshness: 'fresh' as const,
    evidenceAt: state.validatedAt,
    freshUntil: state.nextEligibleAt,
    staleSince: null,
  }
}
