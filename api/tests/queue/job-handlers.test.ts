import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import { listJobContracts } from '../../src/queue/job-contracts.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const mocks = vi.hoisted(() => ({
  affiliation: vi.fn(),
  corporationSource: vi.fn(),
  derivedAuthority: vi.fn(),
  domainEvent: vi.fn(),
  ownerEvidence: vi.fn(),
  planner: vi.fn(),
  resourceRefresh: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ sql: mocks.sql }))
vi.mock('../../src/characters/affiliation-sync.js', () => ({
  processAffiliationBatch: mocks.affiliation,
}))
vi.mock('../../src/domain-events/definitions.js', () => ({
  DomainEventValidationError: class DomainEventValidationError extends Error {},
}))
vi.mock('../../src/domain-events/handlers.js', () => ({
  DomainEventNotFoundError: class DomainEventNotFoundError extends Error {},
  dispatchDomainEvent: mocks.domainEvent,
}))
vi.mock('../../src/domain-events/store.js', () => ({ deletePublishedDomainEvents: vi.fn() }))
vi.mock('../../src/organization/owner-evidence.js', () => ({
  refreshOrganizationOwnerEvidence: mocks.ownerEvidence,
}))
vi.mock('../../src/organization/derived-authority.js', () => ({
  refreshDerivedDirectorAuthority: mocks.derivedAuthority,
}))
vi.mock('../../src/organization/corporation-sources.js', () => ({
  refreshOrganizationCorporationSource: mocks.corporationSource,
}))
vi.mock('../../src/platform/resource-refresh.js', () => ({
  processInstalledResourceRefresh: mocks.resourceRefresh,
}))
vi.mock('../../src/queue/planner.js', () => ({ runQueuePlanner: mocks.planner }))
vi.mock('../../src/queue/outbox-relay.js', () => ({
  outboxRelayStore: {},
  runOutboxRelayBatch: vi.fn(),
}))
vi.mock('../../src/queue/resource-batch-processor.js', () => ({
  processInstalledResourceBatch: vi.fn(),
}))

beforeEach(() => {
  for (const operation of Object.values(mocks)) {
    operation.mockResolvedValue(undefined)
  }
})

describe('job handlers', () => {
  test('verifies exact bidirectional contract coverage', async () => {
    const { listJobHandlerNames, verifyJobHandlers } =
      await import('../../src/queue/job-handlers.js')
    const names = listJobContracts().map(({ name }) => name)
    expect(listJobHandlerNames()).toStrictEqual(names)
    expect(() => verifyJobHandlers()).not.toThrow()
    expect(() => verifyJobHandlers(names.slice(1))).toThrow('has no handler')
    expect(() => verifyJobHandlers([...names, 'unknown'])).toThrow('has no contract')
    expect(() => verifyJobHandlers([...names, names[0]!])).toThrow('Duplicate')
  })

  test('returns completed, retryable, permanent, and absolute delayed dispositions', async () => {
    const { executeJobHandler } = await import('../../src/queue/job-handlers.js')
    const context = executionContext()

    await expect(
      executeJobHandler('diagnostic', { operationId: 'queue-diagnostic' }, context),
    ).resolves.toStrictEqual({ type: 'completed' })

    const retryable = new Error('database unavailable')
    mocks.sql.mockRejectedValueOnce(retryable)
    await expect(
      executeJobHandler('diagnostic', { operationId: 'queue-diagnostic' }, context),
    ).resolves.toStrictEqual({ error: retryable, type: 'retryable' })

    mocks.resourceRefresh.mockRejectedValueOnce(new Error('invalid resource response'))
    await expect(
      executeJobHandler(
        'resource-refresh',
        {
          moduleId: 'member-audit',
          resourceId: 'trained-skills',
          subjectId: '1404328063',
          subjectKind: 'character',
          subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
        },
        context,
      ),
    ).resolves.toStrictEqual({ type: 'permanent' })

    const retryAt = new Date('2026-09-10T12:00:30.000Z')
    mocks.affiliation.mockRejectedValueOnce(new EsiQuotaError(30, Date.now(), retryAt))
    await expect(
      executeJobHandler(
        'affiliation',
        { characterIds: [1], operationId: 'affiliation-1' },
        context,
      ),
    ).resolves.toStrictEqual({ retryAt: retryAt.getTime(), type: 'delayed' })

    mocks.resourceRefresh.mockRejectedValueOnce(
      Object.assign(new Error('ESI quota exhausted'), { retryAt }),
    )
    await expect(
      executeJobHandler(
        'resource-refresh',
        {
          moduleId: 'member-audit',
          resourceId: 'trained-skills',
          subjectId: '1404328063',
          subjectKind: 'character',
          subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
        },
        context,
      ),
    ).resolves.toStrictEqual({ retryAt: retryAt.getTime(), type: 'delayed' })
  })

  test('keeps delayed classification local to handlers that support cooldowns', async () => {
    const { executeJobHandler } = await import('../../src/queue/job-handlers.js')
    const context = executionContext()
    const retryAt = new Date('2026-09-10T12:00:30.000Z')
    const failure = Object.assign(new Error('database unavailable'), { retryAt })
    mocks.sql.mockRejectedValueOnce(failure)

    await expect(
      executeJobHandler('diagnostic', { operationId: 'queue-diagnostic' }, context),
    ).resolves.toStrictEqual({ error: failure, type: 'retryable' })
  })

  test('rethrows shutdown cancellation without classifying it', async () => {
    const controller = new AbortController()
    mocks.resourceRefresh.mockImplementationOnce(async () => {
      controller.abort()
      throw controller.signal.reason
    })
    const { executeJobHandler } = await import('../../src/queue/job-handlers.js')
    const context = { ...executionContext(), signal: controller.signal }

    await expect(
      executeJobHandler(
        'resource-refresh',
        {
          moduleId: 'member-audit',
          resourceId: 'trained-skills',
          subjectId: '1404328063',
          subjectKind: 'character',
          subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
        },
        context,
      ),
    ).rejects.toBe(controller.signal.reason)
  })
})

function executionContext() {
  return {
    outcomes: {
      recordAffiliation: vi.fn().mockResolvedValue(undefined),
      recordOutbox: vi.fn().mockResolvedValue(undefined),
    },
    producer: createInMemoryQueueProducer(),
    signal: new AbortController().signal,
  }
}
