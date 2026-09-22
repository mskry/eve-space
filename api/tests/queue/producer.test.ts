import { describe, expect, test } from 'vitest'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'

const diagnostic = {
  name: 'diagnostic',
  payload: { operationId: 'queue-diagnostic' },
  source: 'planner',
} as const

describe('in-memory queue producer', () => {
  test('returns exhaustive source-specific capacity outcomes', async () => {
    const producer = createInMemoryQueueProducer({ highWaterMark: 1, depth: 1 })

    await expect(producer.inspectCapacity({ source: 'planner' })).resolves.toMatchObject({
      status: 'rejected',
      reason: 'planner-paused',
    })
    await expect(producer.inspectCapacity({ source: 'outbox' })).resolves.toMatchObject({
      status: 'rejected',
      reason: 'outbox-paused',
    })
    await expect(producer.inspectCapacity({ source: 'on-demand' })).resolves.toMatchObject({
      status: 'rejected',
      reason: 'on-demand-rejected',
    })
  })

  test('records accepted semantic commands and coalesces active planner work', async () => {
    const producer = createInMemoryQueueProducer()

    await expect(producer.enqueue(diagnostic)).resolves.toEqual({ status: 'accepted', depth: 0 })
    await expect(producer.enqueue(diagnostic)).resolves.toEqual({
      status: 'rejected',
      depth: 1,
      reason: 'coalesced',
    })
    expect(producer.commands).toEqual([diagnostic])
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
    expect(producer.commands).toEqual([onDemand, onDemand])
  })

  test('coalesces immutable authority work by the production contract identity', async () => {
    const producer = createInMemoryQueueProducer()
    const payload = {
      grantId: '35acd527-9539-44ad-aacf-9f8e45232267',
      organizationVersion: 3,
      sourceSubjectLifecycleId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
      authorizationGeneration: 7,
      roleEvidenceRevision: 'revision-1',
    }

    await expect(
      producer.enqueue({ name: 'organization-owner-evidence', source: 'planner', payload }),
    ).resolves.toEqual({ status: 'accepted', depth: 0 })
    await expect(
      producer.enqueue({
        name: 'organization-owner-evidence',
        source: 'planner',
        payload: {
          roleEvidenceRevision: payload.roleEvidenceRevision,
          authorizationGeneration: payload.authorizationGeneration,
          sourceSubjectLifecycleId: payload.sourceSubjectLifecycleId,
          organizationVersion: payload.organizationVersion,
          grantId: payload.grantId,
        },
      }),
    ).resolves.toEqual({ status: 'rejected', depth: 1, reason: 'coalesced' })
  })
})
