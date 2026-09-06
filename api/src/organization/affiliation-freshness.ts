export function resolveAffiliationFreshness(
  character: {
    readonly affiliationResolutionState: 'pending' | 'resolved' | 'unresolvable'
    readonly affiliationCheckedAt: Date | null
    readonly nextAffiliationCheck: Date | null
  },
  now: Date,
) {
  if (character.affiliationResolutionState !== 'resolved' || !character.affiliationCheckedAt)
    return 'unavailable' as const
  return character.nextAffiliationCheck && character.nextAffiliationCheck > now
    ? ('fresh' as const)
    : ('stale' as const)
}
