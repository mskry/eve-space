import { describe, expect, test } from 'vitest'
import {
  assertSafeJobPayload,
  domainEventJobId,
  getJobDefinition,
  listJobDefinitions,
  resourceBatchJobId,
  resourceRefreshJobId,
  validateJobPayload,
  verifyJobRegistry,
} from '../../src/queue/job-registry.js'

describe('job registry', () => {
  test('registers classified jobs with stable identities and authoritative recovery', () => {
    verifyJobRegistry()
    expect(listJobDefinitions()).toHaveLength(8)
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
    expect(getJobDefinition('affiliation')).toMatchObject({ durability: 'derived', attempts: 5 })
    expect(getJobDefinition('resource-refresh')).toMatchObject({
      durability: 'derived',
      attempts: 1,
    })
    expect(getJobDefinition('resource-batch')).toMatchObject({
      durability: 'derived',
      attempts: 1,
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

  test('accepts only stable resource identity and derives a lifecycle-bound operation identity', () => {
    const job = getJobDefinition('resource-refresh')!
    const payload = {
      moduleId: 'member-audit',
      resourceId: 'trained-skills',
      subjectKind: 'character',
      subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
      subjectId: '1404328063',
    } as const

    expect(validateJobPayload(job, payload)).toEqual(payload)
    expect(resourceRefreshJobId(payload)).toMatch(/^resource-refresh-[0-9a-f]{64}$/)
    expect(resourceRefreshJobId(payload)).toBe(resourceRefreshJobId(payload))
    expect(
      resourceRefreshJobId({
        ...payload,
        subjectLifecycleId: '98a782d2-e042-47d7-9659-03b218121a1a',
      }),
    ).not.toBe(resourceRefreshJobId(payload))
    expect(() => validateJobPayload(job, { ...payload, operationId: 'character-skills' })).toThrow(
      'Invalid resource-refresh',
    )
  })

  test('accepts only bounded batch identities and derives a resource-level operation identity', () => {
    const job = getJobDefinition('resource-batch')!
    const payload = {
      moduleId: 'member-audit',
      resourceId: 'trained-skills',
      subjectKind: 'character' as const,
      subjects: [
        {
          subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
          subjectId: '1404328063',
        },
        {
          subjectLifecycleId: '98a782d2-e042-47d7-9659-03b218121a1a',
          subjectId: '1404328064',
        },
      ],
    }

    expect(validateJobPayload(job, payload)).toEqual(payload)
    expect(resourceBatchJobId(payload)).toMatch(/^resource-batch-[0-9a-f]{64}$/)
    expect(resourceBatchJobId({ ...payload, subjects: payload.subjects.slice(0, 1) })).toBe(
      resourceBatchJobId(payload),
    )
    expect(() => validateJobPayload(job, { ...payload, data: [{ private: true }] })).toThrow(
      'Invalid resource-batch',
    )
    expect(() => validateJobPayload(job, { ...payload, subjects: [] })).toThrow(
      'Invalid resource-batch',
    )
  })
})
