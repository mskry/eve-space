import type { MemberAuditCollectionStatus } from './useMemberAuditReviewerQuery'

const readableRetentionMilliseconds = 24 * 60 * 60 * 1000

export const observationDeadline = (status: MemberAuditCollectionStatus) => {
  if (!status.validatedAt || !status.cachedUntil) return null
  const validatedAt = Date.parse(status.validatedAt)
  const cachedUntil = Date.parse(status.cachedUntil)
  if (!Number.isFinite(validatedAt) || !Number.isFinite(cachedUntil)) return null
  return Math.min(cachedUntil, validatedAt + readableRetentionMilliseconds)
}

export const observationDisplayStatus = (
  status: MemberAuditCollectionStatus,
  now: number | null,
): MemberAuditCollectionStatus['status'] => {
  if (status.status === 'stale') return 'unavailable'
  if (status.status !== 'current') return status.status
  const deadline = observationDeadline(status)
  if (deadline === null) return 'unavailable'
  return now !== null && now >= deadline ? 'unavailable' : 'current'
}
