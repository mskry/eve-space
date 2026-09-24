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
  if (!state?.validatedAt) {
    return {
      evidenceAt: null,
      freshUntil: null,
      freshness: 'unavailable' as const,
      staleSince: state?.failureStartedAt ?? null,
    }
  }
  if (
    state.lastFailureClass ||
    !state.nextEligibleAt ||
    state.nextEligibleAt.getTime() <= now.getTime()
  ) {
    return {
      evidenceAt: state.validatedAt,
      freshUntil: null,
      freshness: 'stale' as const,
      staleSince: state.lastFailureClass
        ? (state.failureStartedAt ?? state.validatedAt)
        : (state.nextEligibleAt ?? state.validatedAt),
    }
  }
  return {
    evidenceAt: state.validatedAt,
    freshUntil: state.nextEligibleAt,
    freshness: 'fresh' as const,
    staleSince: null,
  }
}
