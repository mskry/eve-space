import type { Queue } from 'bullmq'
import { domainEventJobId } from './queue/job-registry.js'

type JobLookup = Pick<Queue, 'getJob'>

export async function assertSelectedDomainEventJobsAbsent(
  eventIds: readonly string[],
  queue: JobLookup,
) {
  const jobs = await Promise.all(eventIds.map((eventId) => queue.getJob(domainEventJobId(eventId))))
  const retainedCount = jobs.filter((job) => job !== undefined).length
  if (retainedCount > 0)
    throw new Error(
      `Queue discard not verified: ${retainedCount} selected domain-event jobs still exist`,
    )
}
