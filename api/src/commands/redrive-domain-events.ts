import { Queue } from 'bullmq'
import {
  parseDomainEventRedriveArgs,
  runDomainEventRedriveCommand,
} from '../domain-events/redrive-command.js'
import {
  countPublishedDomainEventsForRedrive,
  listPublishedDomainEventIdsForRedrive,
  redrivePublishedDomainEvents,
} from '../domain-events/store.js'
import { assertSelectedDomainEventJobsAbsent } from '../domain-events/redrive-queue.js'
import { sql } from '../db/client.js'
import { operationsQueueName, queuePrefix } from '../queue/namespaces.js'
import { closeQueueRedisConnection, createProducerRedisConnection } from '../queue/redis.js'

try {
  const options = parseDomainEventRedriveArgs(process.argv.slice(2))
  const result = await runDomainEventRedriveCommand(options, {
    count: countPublishedDomainEventsForRedrive,
    select: listPublishedDomainEventIdsForRedrive,
    assertQueueJobsAbsent,
    redrive: redrivePublishedDomainEvents,
  })
  console.log(JSON.stringify(result))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Domain-event re-drive failed')
  process.exitCode = 1
} finally {
  await sql.end()
}

async function assertQueueJobsAbsent(eventIds: readonly string[]) {
  if (eventIds.length === 0) return
  const connection = createProducerRedisConnection()
  const queue = new Queue(operationsQueueName, {
    connection,
    prefix: queuePrefix,
    skipWaitingForReady: true,
  })
  try {
    await assertSelectedDomainEventJobsAbsent(eventIds, queue)
  } finally {
    await Promise.allSettled([queue.close(), closeQueueRedisConnection(connection)])
  }
}
