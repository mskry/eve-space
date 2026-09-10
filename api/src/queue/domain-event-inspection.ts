import { domainEventJobId } from './job-contracts.js'
import { createOperationsQueueHandle } from './operations-queue.js'

export async function assertSelectedDomainEventJobsAbsent(eventIds: readonly string[]) {
  if (eventIds.length === 0) return
  const handle = createOperationsQueueHandle()
  try {
    const jobs = await Promise.all(
      eventIds.map((eventId) => handle.queue.getJob(domainEventJobId(eventId))),
    )
    const retainedCount = jobs.filter((job) => job !== undefined).length
    if (retainedCount > 0)
      throw new Error(
        `Queue discard not verified: ${retainedCount} selected domain-event jobs still exist`,
      )
  } finally {
    await handle.close()
  }
}
