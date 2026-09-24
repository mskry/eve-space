import { operationRegistry } from '@evespace/esi-client/operations'
import { describe, expect, test } from 'vitest'
import { env } from '../../src/env.js'
import {
  affiliationJobId,
  assertSafeJobPayload,
  corporationSourceEvidenceJobId,
  derivedAuthorityJobId,
  domainEventJobId,
  getJobContract,
  listJobContracts,
  organizationOwnerEvidenceJobId,
  parseJobPayload,
  resourceBatchJobId,
  resourceRefreshJobId,
  verifyJobContracts,
  type JobName,
  type JobPayloadByName,
} from '../../src/queue/job-contracts.js'

const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'
const grantId = '35acd527-9539-44ad-aacf-9f8e45232267'
const sourceId = '66503848-72b8-4fa3-8af5-de056001a37e'
const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const sourceContext = {
  authorizationGeneration: 7,
  organizationVersion: 3,
  roleEvidenceRevision: '2026-09-21T12:00:00.000Z',
  sourceSubjectLifecycleId: grantId,
} as const
const resourceIdentity = {
  moduleId: 'member-audit',
  resourceId: 'trained-skills',
  subjectId: '1404328063',
  subjectKind: 'character' as const,
  subjectLifecycleId: grantId,
} as const
const resourceBatch = {
  moduleId: 'member-audit',
  resourceId: 'trained-skills',
  subjectKind: 'character' as const,
  subjects: [{ subjectId: '1404328063', subjectLifecycleId: grantId }],
}
const affiliationMaximumBatchSize =
  operationRegistry.PostCharactersAffiliation.transport.protocol.maximumBatchSize
if (affiliationMaximumBatchSize === null) {
  throw new Error('Bulk affiliation operation must declare a maximum batch size')
}

const fixtures = {
  affiliation: { characterIds: [1], operationId: `affiliation-1--${eventId}` },
  'corporation-source-evidence': { sourceId, ...sourceContext },
  'derived-authority': {
    authorizationGeneration: sourceContext.authorizationGeneration,
    characterId: 1_404_328_063,
    organizationVersion: sourceContext.organizationVersion,
    roleEvidenceRevision: null,
    sourceId: null,
    subjectLifecycleId: sourceContext.sourceSubjectLifecycleId,
    userId,
  },
  diagnostic: { operationId: 'queue-diagnostic' },
  'domain-event': { eventId },
  'domain-event-retention': { operationId: 'domain-event-retention' },
  'organization-owner-evidence': {
    grantId,
    ...sourceContext,
  },
  'outbox-relay': { operationId: 'outbox-relay' },
  planner: { operationId: 'queue-planner' },
  'resource-batch': resourceBatch,
  'resource-refresh': resourceIdentity,
} satisfies JobPayloadByName

const expected = [
  ['diagnostic', 3, 'derived', undefined, 'planner-simple', 'planner-stagger', 'none'],
  ['planner', 3, 'derived', undefined, 'scheduler', 'none', 'none'],
  ['domain-event', 5, 'authoritative', 'outbox', 'job-id', 'none', 'none'],
  ['outbox-relay', 3, 'derived', undefined, 'scheduler', 'none', 'none'],
  ['domain-event-retention', 3, 'derived', undefined, 'scheduler', 'none', 'none'],
  ['affiliation', 5, 'derived', undefined, 'job-id', 'none', 'none'],
  ['organization-owner-evidence', 3, 'derived', undefined, 'simple', 'none', 'none'],
  ['corporation-source-evidence', 3, 'derived', undefined, 'simple', 'none', 'none'],
  ['derived-authority', 3, 'derived', undefined, 'simple', 'none', 'none'],
  ['resource-refresh', 1, 'derived', undefined, 'simple', 'planner-stagger', 'resource'],
  ['resource-batch', 1, 'derived', undefined, 'simple', 'planner-stagger', 'resource'],
] as const

describe('job contracts', () => {
  test('characterizes every persisted name, payload, and delivery policy', () => {
    verifyJobContracts()
    expect(listJobContracts()).toHaveLength(expected.length)
    for (const [name, attempts, durability, recovery, deduplication, delay, priority] of expected) {
      const contract = getJobContract(name)
      expect(parseJobPayload(name, fixtures[name])).toStrictEqual(fixtures[name])
      expect(contract).toMatchObject({
        activeWorkDeduplication: deduplication,
        attempts,
        delay,
        durability: { kind: durability, ...(recovery ? { recovery } : {}) },
        name,
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
    expect(organizationOwnerEvidenceJobId(fixtures['organization-owner-evidence'])).toMatch(
      /^organization-owner-evidence-3-7-/,
    )
    expect(corporationSourceEvidenceJobId(fixtures['corporation-source-evidence'])).toMatch(
      /^corporation-source-evidence-3-7-/,
    )
    expect(derivedAuthorityJobId(fixtures['derived-authority'])).toContain('-initial-')
    expect(resourceRefreshJobId(resourceIdentity)).toMatch(/^resource-refresh-[0-9a-f]{64}$/)
    expect(resourceBatchJobId(resourceBatch)).toMatch(/^resource-batch-[0-9a-f]{64}$/)
    expect(
      resourceBatchJobId({
        ...resourceBatch,
        subjects: [
          ...resourceBatch.subjects,
          { subjectId: '1404328064', subjectLifecycleId: eventId },
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

  test('rejects affiliation identities that do not match unique payload characters', () => {
    expect(() =>
      parseJobPayload('affiliation', {
        characterIds: [1, 3],
        operationId: 'affiliation-1-2',
      }),
    ).toThrow('Invalid affiliation')
    expect(() =>
      parseJobPayload('affiliation', {
        characterIds: [1, 1],
        operationId: 'affiliation-1-1',
      }),
    ).toThrow('Invalid affiliation')
  })

  test('strictly rejects malformed and sensitive payloads', () => {
    for (const name of Object.keys(fixtures) as JobName[]) {
      expect(() => parseJobPayload(name, { ...fixtures[name], unexpected: true })).toThrow(
        `Invalid ${name}`,
      )
    }
    expect(() => assertSafeJobPayload({ refreshToken: 'not-allowed' })).toThrow('sensitive')
    expect(() =>
      parseJobPayload('affiliation', {
        characterIds: Array.from({ length: 1001 }, (_, index) => index + 1),
        operationId: 'affiliation-1',
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
  const characterIds = Array.from({ length: size }, (_, index) => index + 1)
  return {
    characterIds,
    operationId: affiliationJobId(characterIds),
  }
}
