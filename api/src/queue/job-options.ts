import { env } from '../env.js'

export function jobOptions(definition: { readonly attempts: number }, jobId?: string) {
  return {
    attempts: definition.attempts,
    backoff: { type: 'exponential' as const, delay: 1_000, jitter: 0.25 },
    ...(jobId ? { jobId } : {}),
    removeOnComplete: {
      age: env.QUEUE_COMPLETED_RETENTION_AGE_SECONDS,
      count: env.QUEUE_COMPLETED_RETENTION_COUNT,
    },
    removeOnFail: {
      age: env.QUEUE_FAILED_RETENTION_AGE_SECONDS,
      count: env.QUEUE_FAILED_RETENTION_COUNT,
    },
  }
}
