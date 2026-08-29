import { UnrecoverableError } from 'bullmq'
import { expect, test } from 'vitest'
import { sanitizeJobFailure } from '../../src/queue/failures.js'

test('reports a safe failure category without exposing error contents or job payloads', () => {
  expect(sanitizeJobFailure(new UnrecoverableError('refresh token leaked'))).toBe(
    'permanent job failure',
  )
  expect(sanitizeJobFailure(new Error('redis://secret-host')).toLowerCase()).not.toContain('secret')
})
