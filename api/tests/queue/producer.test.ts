import { describe, expect, test } from 'vitest'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const diagnostic = {
  name: 'diagnostic',
  payload: { operationId: 'queue-diagnostic' },
  source: 'planner',
} as const

describe('in-memory queue producer', () => {
  test('returns exhaustive source-specific capacity outcomes', async () => {
    const producer = createInMemoryQueueProducer({ depth: 1, highWaterMark: 1 })

    await expect(producer.inspectCapacity({ source: 'planner' })).resolves.toMatchObject({
      reason: 'planner-paused',
      status: 'rejected',
    })
    await expect(producer.inspectCapacity({ source: 'outbox' })).resolves.toMatchObject({
      reason: 'outbox-paused',
      status: 'rejected',
    })
    await expect(producer.inspectCapacity({ source: 'on-demand' })).resolves.toMatchObject({
      reason: 'on-demand-rejected',
      status: 'rejected',
    })
  })

  test('records accepted semantic commands and coalesces active planner work', async () => {
    const producer = createInMemoryQueueProducer()

    await expect(producer.enqueue(diagnostic)).resolves.toStrictEqual({
      depth: 0,
      status: 'accepted',
    })
    await expect(producer.enqueue(diagnostic)).resolves.toStrictEqual({
      depth: 1,
      reason: 'coalesced',
      status: 'rejected',
    })
    expect(producer.commands).toStrictEqual([diagnostic])
  })

  test('models planner pause transitions without affecting on-demand work', async () => {
    const producer = createInMemoryQueueProducer()
    await producer.pausePlanner()
    expect(producer.plannerPaused).toBe(true)
    await producer.resumePlanner()
    expect(producer.plannerPaused).toBe(false)

    const onDemand = { ...diagnostic, source: 'on-demand' as const }
    await producer.enqueue(onDemand)
    await producer.enqueue(onDemand)
    expect(producer.commands).toStrictEqual([onDemand, onDemand])
  })

  test('coalesces immutable authority work by the production contract identity', async () => {
    const producer = createInMemoryQueueProducer()
    const payload = {
      authorizationGeneration: 7,
      grantId: '35acd527-9539-44ad-aacf-9f8e45232267',
      organizationVersion: 3,
      roleEvidenceRevision: 'revision-1',
      sourceSubjectLifecycleId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
    }

    await expect(
      producer.enqueue({ name: 'organization-owner-evidence', payload, source: 'planner' }),
    ).resolves.toStrictEqual({ depth: 0, status: 'accepted' })
    await expect(
      producer.enqueue({
        name: 'organization-owner-evidence',
        payload: {
          authorizationGeneration: payload.authorizationGeneration,
          grantId: payload.grantId,
          organizationVersion: payload.organizationVersion,
          roleEvidenceRevision: payload.roleEvidenceRevision,
          sourceSubjectLifecycleId: payload.sourceSubjectLifecycleId,
        },
        source: 'planner',
      }),
    ).resolves.toStrictEqual({ depth: 1, reason: 'coalesced', status: 'rejected' })
  })
})
