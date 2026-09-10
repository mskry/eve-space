import { sql } from '../db/client.js'
import { listJobContracts } from '../queue/job-contracts.js'
import {
  parseExpectedRecoverySnapshot,
  verifyQueueDiscardRecovery,
  verifyRollbackJobContracts,
  type DomainEventRecoverySnapshot,
} from '../worker/rollback-verifier.js'
import { logSafeError } from '../logging.js'

try {
  const expectedSnapshot = parseExpectedRecoverySnapshot(process.argv.slice(2))
  verifyRollbackJobContracts(listJobContracts())
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
  logSafeError('Worker rollback verification failed', error)
  process.exitCode = 1
} finally {
  await sql.end()
}
