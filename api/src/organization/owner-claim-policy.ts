import {
  resolveAuthorityEvidenceState,
  type AuthorityEvidenceClock,
  type AuthorityEvidenceState,
} from './authority-policy.js'

interface OrganizationOwnerClaimState {
  readonly status: AuthorityEvidenceState | null
  readonly freshUntil: Date | null
  readonly graceUntil: Date | null
  readonly invalidatedAt: Date | null
}

export function isOrganizationOwnerClaimAvailable(
  owner: OrganizationOwnerClaimState | undefined,
  now = new Date(),
) {
  if (!owner?.status || !owner.freshUntil) {
    return true
  }
  const evidence: AuthorityEvidenceClock = {
    freshUntil: owner.freshUntil,
    graceUntil: owner.graceUntil,
    invalidatedAt: owner.invalidatedAt,
    status: owner.status,
  }
  return resolveAuthorityEvidenceState(evidence, now) === 'invalid'
}
