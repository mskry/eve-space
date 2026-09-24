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
import { recordDiagnostic } from '../logging.js'

try {
  const options = parseDomainEventRedriveArgs(process.argv.slice(2))
  const result = await runDomainEventRedriveCommand(options, {
    assertQueueJobsAbsent: assertSelectedDomainEventJobsAbsent,
    count: countPublishedDomainEventsForRedrive,
    redrive: redrivePublishedDomainEvents,
    select: listPublishedDomainEventIdsForRedrive,
  })
  console.log(JSON.stringify(result))
} catch (error) {
  recordDiagnostic('command.domain-event-redrive.failed', { error })
  process.exitCode = 1
} finally {
  await sql.end().catch((error) => {
    recordDiagnostic('command.domain-event-redrive.failed', { error })
    process.exitCode = 1
  })
}
