import { UnrecoverableError } from 'bullmq'

export function sanitizeJobFailure(error: unknown) {
  if (error instanceof UnrecoverableError) return 'permanent job failure'
  return 'retryable dependency failure'
}
