import { sql } from './db/client.js'
import { listJobDefinitions } from './queue/job-registry.js'
import {
  parseExpectedRecoverySnapshot,
  verifyQueueDiscardRecovery,
  verifyRollbackJobRegistry,
  type DomainEventRecoverySnapshot,
} from './worker-rollback-verifier.js'

try {
  const expectedSnapshot = parseExpectedRecoverySnapshot(process.argv.slice(2))
  verifyRollbackJobRegistry(listJobDefinitions())
  const [row] = await sql<
    {
      eventCount: number
      publishedCount: number
      unpublishedCount: number
      earliestPublishedAt: string | null
      latestPublishedAt: string | null
    }[]
  >`
    select
      count(*)::integer as "eventCount",
      count(*) filter (where published_at is not null)::integer as "publishedCount",
      count(*) filter (where published_at is null)::integer as "unpublishedCount",
      min(published_at) as "earliestPublishedAt",
      max(published_at) as "latestPublishedAt"
    from domain_events
  `
  if (!row) throw new Error('PostgreSQL domain-event recovery is unavailable')
  const snapshot: DomainEventRecoverySnapshot = {
    ...row,
  }
  console.log(
    JSON.stringify(
      verifyQueueDiscardRecovery({
        confirmation: process.env.EVE_SPACE_CONFIRM_QUEUE_DISCARD,
        snapshot,
        expectedSnapshot,
      }),
    ),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Worker rollback verification failed')
  process.exitCode = 1
} finally {
  await sql.end()
}
