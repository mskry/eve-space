import { operationRegistry } from '@evespace/esi-client/operations'
import { describe, expect, test } from 'vitest'
import { env } from '../../src/env.js'
import {
  affiliationJobId,
  assertSafeJobPayload,
  domainEventJobId,
  getJobContract,
  listJobContracts,
  parseJobPayload,
  resourceBatchJobId,
  resourceRefreshJobId,
  verifyJobContracts,
  type JobName,
  type JobPayloadByName,
} from '../../src/queue/job-contracts.js'

const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'
const grantId = '35acd527-9539-44ad-aacf-9f8e45232267'
const resourceIdentity = {
  moduleId: 'member-audit',
  resourceId: 'trained-skills',
  subjectKind: 'character' as const,
  subjectLifecycleId: grantId,
  subjectId: '1404328063',
} as const
const resourceBatch = {
  moduleId: 'member-audit',
  resourceId: 'trained-skills',
  subjectKind: 'character' as const,
  subjects: [{ subjectLifecycleId: grantId, subjectId: '1404328063' }],
}
const affiliationMaximumBatchSize =
  operationRegistry.PostCharactersAffiliation.transport.protocol.maximumBatchSize
if (affiliationMaximumBatchSize === null)
  throw new Error('Bulk affiliation operation must declare a maximum batch size')

const fixtures = {
  diagnostic: { operationId: 'queue-diagnostic' },
  planner: { operationId: 'queue-planner' },
  'domain-event': { eventId },
  'outbox-relay': { operationId: 'outbox-relay' },
  'domain-event-retention': { operationId: 'domain-event-retention' },
  affiliation: { operationId: `affiliation-1--${eventId}`, characterIds: [1] },
  'organization-owner-evidence': {
    operationId: `organization-owner-evidence-${grantId}`,
    grantId,
  },
  'resource-refresh': resourceIdentity,
  'resource-batch': resourceBatch,
} satisfies JobPayloadByName

const expected = [
  ['diagnostic', 3, 'derived', undefined, 'planner-simple', 'planner-stagger', 'none'],
  ['planner', 3, 'derived', undefined, 'scheduler', 'none', 'none'],
  ['domain-event', 5, 'authoritative', 'outbox', 'job-id', 'none', 'none'],
  ['outbox-relay', 3, 'derived', undefined, 'scheduler', 'none', 'none'],
  ['domain-event-retention', 3, 'derived', undefined, 'scheduler', 'none', 'none'],
  ['affiliation', 5, 'derived', undefined, 'job-id', 'none', 'none'],
  ['organization-owner-evidence', 3, 'derived', undefined, 'simple', 'none', 'none'],
  ['resource-refresh', 1, 'derived', undefined, 'simple', 'planner-stagger', 'resource'],
  ['resource-batch', 1, 'derived', undefined, 'simple', 'planner-stagger', 'resource'],
] as const

describe('job contracts', () => {
  test('characterizes every persisted name, payload, and delivery policy', () => {
    verifyJobContracts()
    expect(listJobContracts()).toHaveLength(expected.length)
    for (const [name, attempts, durability, recovery, deduplication, delay, priority] of expected) {
      const contract = getJobContract(name)
      expect(parseJobPayload(name, fixtures[name])).toEqual(fixtures[name])
      expect(contract).toMatchObject({
        name,
        attempts,
        durability: { kind: durability, ...(recovery ? { recovery } : {}) },
        activeWorkDeduplication: deduplication,
        delay,
        priority,
        retention: {
          completed: {
            age: env.QUEUE_COMPLETED_RETENTION_AGE_SECONDS,
            count: env.QUEUE_COMPLETED_RETENTION_COUNT,
          },
          failed: {
            age: env.QUEUE_FAILED_RETENTION_AGE_SECONDS,
            count: env.QUEUE_FAILED_RETENTION_COUNT,
          },
        },
      })
      expect(contract.operationIdentity(fixtures[name] as never)).not.toContain(':')
    }
  })

  test('preserves deterministic identities and resource active-work scopes', () => {
    expect(affiliationJobId([3, 1, 2])).toBe('affiliation-1-2-3')
    expect(affiliationJobId([3, 1, 2], eventId)).toBe(`affiliation-1-2-3--${eventId}`)
    expect(domainEventJobId(eventId)).toBe(`domain-event-${eventId}`)
    expect(resourceRefreshJobId(resourceIdentity)).toMatch(/^resource-refresh-[0-9a-f]{64}$/)
    expect(resourceBatchJobId(resourceBatch)).toMatch(/^resource-batch-[0-9a-f]{64}$/)
    expect(
      resourceBatchJobId({
        ...resourceBatch,
        subjects: [
          ...resourceBatch.subjects,
          { subjectLifecycleId: eventId, subjectId: '1404328064' },
        ],
      }),
    ).toBe(resourceBatchJobId(resourceBatch))
  })

  test('matches affiliation payload capacity to the generated ESI operation limit', () => {
    expect(() =>
      parseJobPayload('affiliation', affiliationPayload(affiliationMaximumBatchSize)),
    ).not.toThrow()
    expect(() =>
      parseJobPayload('affiliation', affiliationPayload(affiliationMaximumBatchSize + 1)),
    ).toThrow('Invalid affiliation')
  })

  test('strictly rejects malformed and sensitive payloads', () => {
    for (const name of Object.keys(fixtures) as JobName[])
      expect(() => parseJobPayload(name, { ...fixtures[name], unexpected: true })).toThrow(
        `Invalid ${name}`,
      )
    expect(() => assertSafeJobPayload({ refreshToken: 'not-allowed' })).toThrow('sensitive')
    expect(() =>
      parseJobPayload('affiliation', {
        operationId: 'affiliation-1',
        characterIds: Array.from({ length: 1_001 }, (_, index) => index + 1),
      }),
    ).toThrow('Invalid affiliation')
  })

  test('rejects duplicate and unbacked authoritative contracts', () => {
    const diagnostic = getJobContract('diagnostic')
    expect(() => verifyJobContracts([diagnostic, diagnostic])).toThrow('Duplicate')
    expect(() =>
      verifyJobContracts([
        {
          ...diagnostic,
          durability: { kind: 'authoritative', recovery: undefined },
        } as never,
      ]),
    ).toThrow('outbox recovery')
  })
})

function affiliationPayload(size: number) {
  return {
    operationId: 'affiliation-1',
    characterIds: Array.from({ length: size }, (_, index) => index + 1),
  }
}
