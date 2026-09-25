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

  test('coalesces owner, source, and derived demand for one role binding', async () => {
    const producer = createInMemoryQueueProducer()
    const payload = {
      affiliationPeriodRevision: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
      authorityCorporationId: 98_000_001,
      authorizationGeneration: 7,
      characterId: 1_404_328_063,
      expectedRoleRevision: null,
      organizationVersion: 3,
      subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    }
    const notBefore = new Date()

    await expect(
      producer.enqueue({
        name: 'corporation-role-observation',
        notBefore,
        payload,
        source: 'planner',
      }),
    ).resolves.toStrictEqual({ depth: 0, status: 'accepted' })
    await expect(
      producer.enqueue({
        name: 'corporation-role-observation',
        notBefore,
        payload: { ...payload, authorizationGeneration: 8 },
        source: 'planner',
      }),
    ).resolves.toStrictEqual({ depth: 1, reason: 'coalesced', status: 'rejected' })
  })
})
