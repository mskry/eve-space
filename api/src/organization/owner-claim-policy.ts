interface OrganizationOwnerClaimState {
  failureClass: string | null
  reviewDeadline: Date | null
}

export function isOrganizationOwnerClaimAvailable(
  owner: OrganizationOwnerClaimState | undefined,
  now = new Date(),
) {
  return (
    !owner ||
    owner.failureClass?.startsWith('strict:') === true ||
    (owner.reviewDeadline !== null && owner.reviewDeadline <= now)
  )
}
