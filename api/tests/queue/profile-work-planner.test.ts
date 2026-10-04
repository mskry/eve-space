import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test, vi } from 'vitest'
import { env } from '../../src/env.js'
import { platformResources } from '../../src/platform/resources.js'
import { profileRefreshJobId } from '../../src/queue/job-contracts.js'
import type { QueueOutcomeRecorder } from '../../src/queue/outcome-recorder.js'
import { createInMemoryQueueProducer } from '../../src/queue/producer.js'
import { runProfileWorkPlanner } from '../../src/queue/profile-work-planner.js'

const resource = platformResources.find(
  (entry) => entry.moduleId === 'market' && entry.resourceId === 'orders',
)!
const resourceIdentity = {
  moduleId: 'market',
  resourceId: 'orders',
  subjectId: '1',
  subjectKind: 'deployment' as const,
  subjectLifecycleId: randomUUID(),
}
const candidate = { identity: resourceIdentity, operationId: 'market-region-orders' as const }
const profileId = randomUUID()
const anotherProfileId = randomUUID()
const plan = vi.fn()
const selectDue = vi.fn()
const cooldowns = vi.fn()
const outcomes: QueueOutcomeRecorder = {
  recordAffiliation: vi
    .fn<QueueOutcomeRecorder['recordAffiliation']>()
    .mockResolvedValue(undefined),
  recordOutbox: vi.fn<QueueOutcomeRecorder['recordOutbox']>().mockResolvedValue(undefined),
}

beforeEach(() => {
  plan
    .mockReset()
    .mockResolvedValue([
      { resourceIdentity, profileId, revision: 1, dueAt: '2026-09-28T12:00:00Z' },
    ])
  selectDue.mockReset().mockResolvedValue([candidate])
  cooldowns
    .mockReset()
    .mockResolvedValue([{ active: false, coordinationAvailable: true, retryAfterSeconds: null }])
})

test('admits a stable profile-keyed job and coalesces repeated planner passes', async () => {
  const producer = createInMemoryQueueProducer()
  const context = { producer, outcomes: {} as never }
  const options = { resources: [resource], selectDue, plan, cooldowns }
  expect(await runProfileWorkPlanner(context, options)).toMatchObject({
    planned: 1,
    selected: 1,
    reason: 'scheduled',
  })
  expect(selectDue).toHaveBeenCalledWith(
    expect.objectContaining({ includeProfileKeyed: true, resources: [resource] }),
  )
  const [command] = producer.commands
  expect(command?.name).toBe('module-profile-refresh')
  if (command?.name !== 'module-profile-refresh') throw new Error('Expected profile work')
  expect(command.payload).toMatchObject({ profileId, revision: 1 })
  expect(profileRefreshJobId(command.payload)).toMatch(/^module-profile-refresh-[\da-f]{64}$/)
  expect((await runProfileWorkPlanner(context, options)).planned).toBe(0)
  expect(producer.commands).toHaveLength(1)
})

test('leaves omitted profiles due when queue capacity accepts only a prefix', async () => {
  const producer = createInMemoryQueueProducer()
  producer.setDepth(env.QUEUE_HIGH_WATER_MARK - 1)
  plan.mockResolvedValueOnce([
    { resourceIdentity, profileId, revision: 1, dueAt: '2026-09-28T12:00:00Z' },
    { resourceIdentity, profileId: anotherProfileId, revision: 1, dueAt: '2026-09-28T12:01:00Z' },
  ])
  const result = await runProfileWorkPlanner(
    { producer, outcomes: {} as never },
    { resources: [resource], selectDue, plan, cooldowns },
  )
  expect(result).toMatchObject({ planned: 1, selected: 2 })
  expect(producer.commands).toHaveLength(1)
})

test('defers due work during a registered market-order cooldown', async () => {
  cooldowns.mockResolvedValueOnce([
    { active: true, coordinationAvailable: true, retryAfterSeconds: 60 },
  ])
  const producer = createInMemoryQueueProducer()
  expect(
    await runProfileWorkPlanner(
      { producer, outcomes: {} as never },
      { resources: [resource], selectDue, plan, cooldowns },
    ),
  ).toMatchObject({ planned: 0, reason: 'cooldown' })
  expect(producer.commands).toHaveLength(0)
})

test('admits bounded local work past an upstream cooldown while preserving planner pause state', async () => {
  plan.mockResolvedValue([
    { resourceIdentity, profileId, revision: 1, dueAt: '2026-09-28T12:00:00Z' },
    {
      resourceIdentity,
      profileId: anotherProfileId,
      revision: 1,
      dueAt: '2026-09-28T12:01:00Z',
      localWorkPending: true,
    },
  ])
  cooldowns.mockResolvedValue([
    { active: true, coordinationAvailable: true, retryAfterSeconds: 60 },
  ])
  const producer = createInMemoryQueueProducer()
  const context = { producer, outcomes }
  const options = { resources: [resource], selectDue, plan, cooldowns }
  expect(await runProfileWorkPlanner(context, options)).toMatchObject({
    planned: 1,
    reason: 'cooldown',
  })
  expect(producer.commands).toMatchObject([{ payload: { profileId: anotherProfileId } }])
  await producer.pausePlanner()
  expect(await runProfileWorkPlanner(context, options)).toMatchObject({
    planned: 0,
    reason: 'cooldown',
  })
  expect(producer.plannerPaused).toBe(true)
  expect(producer.commands).toHaveLength(1)
})
