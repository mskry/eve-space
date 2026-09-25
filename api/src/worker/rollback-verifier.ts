import { verifyJobContracts, type JobContract, type JobName } from '../queue/job-contracts.js'

export interface DomainEventRecoverySnapshot {
  eventCount: number
  publishedCount: number
  unpublishedCount: number
  earliestPublishedAt: string | null
  latestPublishedAt: string | null
}

export function verifyRollbackJobContracts(contracts: readonly JobContract<JobName>[]) {
  verifyJobContracts(contracts)
  return {
    authoritativeCount: contracts.filter((job) => job.durability.kind === 'authoritative').length,
  }
}

export function parseExpectedRecoverySnapshot(args: readonly string[]) {
  if (args.length === 0) {
    return
  }
  if (args.length !== 2 || args[0] !== '--expected-snapshot') {
    throw new Error('Expected only --expected-snapshot <JSON>')
  }

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
  if (options.confirmation !== '1') {
    throw new Error('EVE_SPACE_CONFIRM_QUEUE_DISCARD must be 1')
  }
  const snapshot = validateRecoverySnapshot(options.snapshot)
  if (snapshot.eventCount === 0) {
    throw new Error('Queue discard requires at least one retained PostgreSQL domain event')
  }
  if (snapshot.publishedCount + snapshot.unpublishedCount !== snapshot.eventCount) {
    throw new Error('PostgreSQL domain-event recovery counts are inconsistent')
  }
  const expectedSnapshot = options.expectedSnapshot
    ? validateRecoverySnapshot(options.expectedSnapshot)
    : undefined
  if (expectedSnapshot && !snapshotsEqual(snapshot, expectedSnapshot)) {
    throw new Error('PostgreSQL domain-event recovery changed during queue discard')
  }
  return snapshot
}

const readRecoveryCount = (
  snapshot: Record<string, unknown>,
  field: 'eventCount' | 'publishedCount' | 'unpublishedCount',
): number => {
  const value = snapshot[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid recovery snapshot ${field}`)
  }
  return value
}

const readRecoveryTimestamp = (
  snapshot: Record<string, unknown>,
  field: 'earliestPublishedAt' | 'latestPublishedAt',
): string | null => {
  const value = snapshot[field]
  if (value !== null && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) {
    throw new Error(`Invalid recovery snapshot ${field}`)
  }
  return value
}

function validateRecoverySnapshot(value: unknown): DomainEventRecoverySnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid recovery snapshot')
  }
  const snapshot = value as Record<string, unknown>
  const eventCount = readRecoveryCount(snapshot, 'eventCount')
  const publishedCount = readRecoveryCount(snapshot, 'publishedCount')
  const unpublishedCount = readRecoveryCount(snapshot, 'unpublishedCount')
  const earliestPublishedAt = readRecoveryTimestamp(snapshot, 'earliestPublishedAt')
  const latestPublishedAt = readRecoveryTimestamp(snapshot, 'latestPublishedAt')
  const invalidPublicationRange =
    publishedCount === 0
      ? earliestPublishedAt !== null || latestPublishedAt !== null
      : earliestPublishedAt === null || latestPublishedAt === null
  if (invalidPublicationRange) {
    throw new Error('Invalid recovery snapshot publication range')
  }
  if (
    earliestPublishedAt !== null &&
    latestPublishedAt !== null &&
    Date.parse(earliestPublishedAt) > Date.parse(latestPublishedAt)
  ) {
    throw new Error('Invalid recovery snapshot publication range')
  }
  return {
    eventCount,
    publishedCount,
    unpublishedCount,
    earliestPublishedAt,
    latestPublishedAt,
  }
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
