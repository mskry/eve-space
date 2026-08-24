import { describe, expect, test } from 'vitest'
import {
  assertSafeJobPayload,
  domainEventJobId,
  getJobDefinition,
  listJobDefinitions,
  validateJobPayload,
  verifyJobRegistry,
} from '../src/queue/job-registry.js'

describe('job registry', () => {
  test('registers classified jobs with stable identities and authoritative recovery', () => {
    verifyJobRegistry()
    expect(listJobDefinitions()).toHaveLength(5)
    const job = getJobDefinition('diagnostic') as {
      operationIdentity(payload: { operationId: 'queue-diagnostic' }): string
      durability: string
    }

    expect(job.durability).toBe('derived')
    expect(job.operationIdentity({ operationId: 'queue-diagnostic' })).toBe('queue-diagnostic')
    expect(getJobDefinition('domain-event')).toMatchObject({
      durability: 'authoritative',
      recovery: 'outbox',
      attempts: 5,
    })
  })

  test('fails verification for omitted classifications or unbacked authoritative jobs', () => {
    expect(() => verifyJobRegistry([{ name: 'missing' }])).toThrow('must declare')
    expect(() =>
      verifyJobRegistry([{ name: 'outbox-needed', durability: 'authoritative' } as never]),
    ).toThrow('outbox recovery')
    expect(() =>
      verifyJobRegistry([{ name: 'backed', durability: 'authoritative', recovery: 'outbox' }]),
    ).not.toThrow()
  })

  test('rejects malformed and sensitive payloads before work starts', () => {
    const job = getJobDefinition('diagnostic')!

    expect(() => validateJobPayload(job, { operationId: 'other' })).toThrow('Invalid diagnostic')
    expect(() => assertSafeJobPayload({ refreshToken: 'not-allowed' })).toThrow('sensitive')
  })

  test('accepts only an event ID and derives a namespace-safe deterministic job ID', () => {
    const job = getJobDefinition('domain-event')!
    const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'

    expect(validateJobPayload(job, { eventId })).toEqual({ eventId })
    expect(domainEventJobId(eventId)).toBe(`domain-event-${eventId}`)
    expect(domainEventJobId(eventId)).not.toContain(':')
    expect(() => validateJobPayload(job, { eventId, eventType: 'character.attached' })).toThrow(
      'Invalid domain-event',
    )
    expect(() => validateJobPayload(job, { eventId: 'not-a-uuid' })).toThrow('Invalid domain-event')
  })
})
