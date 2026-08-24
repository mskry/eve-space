import type { JobDefinition } from './queue/job-registry.js'
import { verifyJobRegistry } from './queue/job-registry.js'

export interface DomainEventRecoverySnapshot {
  eventCount: number
  publishedCount: number
  unpublishedCount: number
  earliestPublishedAt: string | null
  latestPublishedAt: string | null
}

export function verifyRollbackJobRegistry(registry: readonly Partial<JobDefinition<unknown>>[]) {
  verifyJobRegistry(registry)
  return {
    authoritativeCount: registry.filter((job) => job.durability === 'authoritative').length,
  }
}

export function parseExpectedRecoverySnapshot(args: readonly string[]) {
  if (args.length === 0) return undefined
  if (args.length !== 2 || args[0] !== '--expected-snapshot')
    throw new Error('Expected only --expected-snapshot <JSON>')

  let parsed: unknown
  try {
    parsed = JSON.parse(args[1]!)
  } catch {
    throw new Error('--expected-snapshot must be valid JSON')
  }
  return validateRecoverySnapshot(parsed)
}

export function verifyQueueDiscardRecovery(options: {
  confirmation: string | undefined
  snapshot: DomainEventRecoverySnapshot
  expectedSnapshot?: DomainEventRecoverySnapshot
}) {
  if (options.confirmation !== '1') throw new Error('EVE_SPACE_CONFIRM_QUEUE_DISCARD must be 1')
  const snapshot = validateRecoverySnapshot(options.snapshot)
  if (snapshot.eventCount === 0)
    throw new Error('Queue discard requires at least one retained PostgreSQL domain event')
  if (snapshot.publishedCount + snapshot.unpublishedCount !== snapshot.eventCount)
    throw new Error('PostgreSQL domain-event recovery counts are inconsistent')
  const expectedSnapshot = options.expectedSnapshot
    ? validateRecoverySnapshot(options.expectedSnapshot)
    : undefined
  if (expectedSnapshot && !snapshotsEqual(snapshot, expectedSnapshot))
    throw new Error('PostgreSQL domain-event recovery changed during queue discard')
  return snapshot
}

function validateRecoverySnapshot(value: unknown): DomainEventRecoverySnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid recovery snapshot')
  const snapshot = value as Record<string, unknown>
  for (const field of ['eventCount', 'publishedCount', 'unpublishedCount'] as const) {
    if (!Number.isInteger(snapshot[field]) || (snapshot[field] as number) < 0)
      throw new Error(`Invalid recovery snapshot ${field}`)
  }
  for (const field of ['earliestPublishedAt', 'latestPublishedAt'] as const) {
    const timestamp = snapshot[field]
    if (
      timestamp !== null &&
      (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp)))
    )
      throw new Error(`Invalid recovery snapshot ${field}`)
  }
  const earliest = snapshot.earliestPublishedAt as string | null
  const latest = snapshot.latestPublishedAt as string | null
  const invalidPublicationRange =
    snapshot.publishedCount === 0
      ? earliest !== null || latest !== null
      : earliest === null || latest === null
  if (invalidPublicationRange) throw new Error('Invalid recovery snapshot publication range')
  if (earliest !== null && latest !== null && Date.parse(earliest) > Date.parse(latest))
    throw new Error('Invalid recovery snapshot publication range')
  return snapshot as unknown as DomainEventRecoverySnapshot
}

function snapshotsEqual(
  actual: DomainEventRecoverySnapshot,
  expected: DomainEventRecoverySnapshot,
) {
  return (
    actual.eventCount === expected.eventCount &&
    actual.publishedCount === expected.publishedCount &&
    actual.unpublishedCount === expected.unpublishedCount &&
    actual.earliestPublishedAt === expected.earliestPublishedAt &&
    actual.latestPublishedAt === expected.latestPublishedAt
  )
}
