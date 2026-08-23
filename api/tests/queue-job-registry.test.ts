import { describe, expect, test } from 'vitest'
import {
  assertSafeJobPayload,
  getJobDefinition,
  listJobDefinitions,
  validateJobPayload,
  verifyJobRegistry,
} from '../src/queue/job-registry.js'

describe('job registry', () => {
  test('registers only classified derived jobs with stable identities', () => {
    verifyJobRegistry()
    expect(listJobDefinitions()).toHaveLength(2)
    const job = getJobDefinition('diagnostic') as {
      operationIdentity(payload: { operationId: 'queue-diagnostic' }): string
      durability: string
    }

    expect(job.durability).toBe('derived')
    expect(job.operationIdentity({ operationId: 'queue-diagnostic' })).toBe('queue-diagnostic')
  })

  test('fails verification for omitted or authoritative classifications', () => {
    expect(() => verifyJobRegistry([{ name: 'missing' }])).toThrow('must declare')
    expect(() =>
      verifyJobRegistry([{ name: 'outbox-needed', durability: 'authoritative' }]),
    ).toThrow('outbox-backed')
  })

  test('rejects malformed and sensitive payloads before work starts', () => {
    const job = getJobDefinition('diagnostic')!

    expect(() => validateJobPayload(job, { operationId: 'other' })).toThrow('Invalid diagnostic')
    expect(() => assertSafeJobPayload({ refreshToken: 'not-allowed' })).toThrow('sensitive')
  })
})
