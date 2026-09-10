import {
  parseDomainEventRedriveArgs,
  runDomainEventRedriveCommand,
} from '../domain-events/redrive-command.js'
import {
  countPublishedDomainEventsForRedrive,
  listPublishedDomainEventIdsForRedrive,
  redrivePublishedDomainEvents,
} from '../domain-events/store.js'
import { sql } from '../db/client.js'
import { assertSelectedDomainEventJobsAbsent } from '../queue/domain-event-inspection.js'
import { logSafeError } from '../logging.js'

try {
  const options = parseDomainEventRedriveArgs(process.argv.slice(2))
  const result = await runDomainEventRedriveCommand(options, {
    count: countPublishedDomainEventsForRedrive,
    select: listPublishedDomainEventIdsForRedrive,
    assertQueueJobsAbsent: assertSelectedDomainEventJobsAbsent,
    redrive: redrivePublishedDomainEvents,
  })
  console.log(JSON.stringify(result))
} catch (error) {
  logSafeError('Domain-event re-drive failed', error)
  process.exitCode = 1
} finally {
  await sql.end()
}
