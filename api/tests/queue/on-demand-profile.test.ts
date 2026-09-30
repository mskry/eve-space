import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DueInstalledResource } from '../../src/platform/resource-eligibility.js'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  plan: vi.fn(),
  enqueue: vi.fn(),
  disconnect: vi.fn(),
  createHandle: vi.fn(),
  cooldowns: vi.fn(),
  getDeduplicationJobId: vi.fn(),
  getJobState: vi.fn(),
}))
vi.mock('../../src/platform/resource-eligibility.js', () => ({
  selectDueInstalledResources: mocks.select,
}))
vi.mock('../../src/platform/profile-work.js', () => ({
  planInstalledProfileWork: mocks.plan,
}))
vi.mock('../../src/platform/resource-planning.js', () => ({
  createResourcePlanningCooldownRequest: () => ({
    operation: 'market-region-history',
  }),
  getResourcePlanningCooldowns: mocks.cooldowns,
}))
vi.mock('../../src/coordination-redis.js', () => ({
  getSharedCoordinationRedisConnection: () => ({}),
}))
vi.mock('../../src/queue/operations-queue.js', () => ({
  createOperationsQueueHandle: mocks.createHandle,
}))
vi.mock('../../src/queue/bullmq-producer.js', () => ({
  createBullMqQueueProducer: () => ({ enqueue: mocks.enqueue }),
}))

import { createOnDemandProfileRequester } from '../../src/queue/on-demand-profile.js'

const descriptor = {
  publisherPackage: '@eve-space/market-manifest',
  moduleId: 'market',
  routeId: 'daily-history-demand',
  resourceId: 'daily-history',
}
const profileId = randomUUID()
const resourceIdentity = {
  moduleId: 'market',
  resourceId: 'daily-history',
  subjectKind: 'deployment' as const,
  subjectId: '1',
  subjectLifecycleId: randomUUID(),
}
const input = { profileId, revision: 1, typeId: 34 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.select.mockResolvedValue([{ identity: resourceIdentity }])
  mocks.plan.mockResolvedValue([
    { resourceIdentity, profileId, revision: 1, dueAt: '1970-01-01T00:00:00Z' },
  ])
  mocks.enqueue.mockResolvedValue({ status: 'accepted' })
  mocks.getDeduplicationJobId.mockResolvedValue('job-1')
  mocks.getJobState.mockResolvedValue('completed')
  mocks.cooldowns.mockResolvedValue([{ active: false }])
  mocks.createHandle.mockReturnValue({
    queue: {
      getDeduplicationJobId: mocks.getDeduplicationJobId,
      getJobState: mocks.getJobState,
    },
    disconnect: mocks.disconnect,
  })
})
afterEach(() => vi.useRealTimers())

test('wakes exact type work through ordinary queue admission without planner staggering', async () => {
  const requester = createOnDemandProfileRequester(descriptor)
  expect(await requester.request(input)).toBe('completed')
  expect(mocks.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'module-profile-refresh',
      source: 'on-demand',
      payload: expect.objectContaining({
        profileId,
        revision: 1,
        requestedTypeId: 34,
        resourceId: 'daily-history',
      }),
    }),
  )
  expect(await requester.request({ ...input, typeId: 35 })).toBe('completed')
  expect(mocks.createHandle).toHaveBeenCalledOnce()
  expect(mocks.disconnect).not.toHaveBeenCalled()
})

test.each([
  { state: 'prioritized', outcome: 'queued' },
  { state: 'active', outcome: 'collecting' },
])('bounds the response wait and reports $outcome', async ({ state, outcome }) => {
  vi.useFakeTimers()
  mocks.getJobState.mockResolvedValue(state)
  const pending = createOnDemandProfileRequester(descriptor).request(input)
  await vi.advanceTimersByTimeAsync(3_000)
  expect(await pending).toBe(outcome)
})

test('does not enqueue an obsolete revision or malformed type', async () => {
  const requester = createOnDemandProfileRequester(descriptor)
  expect(await requester.request({ ...input, revision: 2 })).toBe('unavailable')
  expect(await requester.request({ ...input, typeId: 0 })).toBe('unavailable')
  expect(mocks.enqueue).not.toHaveBeenCalled()
  expect(mocks.createHandle).not.toHaveBeenCalled()
})

test('keeps saved demand waiting while the profile is outside the due plan', async () => {
  mocks.plan.mockResolvedValue([])
  expect(await createOnDemandProfileRequester(descriptor).request(input)).toBe('waiting')
  expect(mocks.enqueue).not.toHaveBeenCalled()
})

test('reports failed queue admission', async () => {
  mocks.enqueue.mockResolvedValue({ status: 'rejected', reason: 'capacity' })
  expect(await createOnDemandProfileRequester(descriptor).request(input)).toBe('waiting')
})

test('does not wake collection while the history operation is cooling down', async () => {
  mocks.cooldowns.mockResolvedValue([{ active: true }])
  expect(await createOnDemandProfileRequester(descriptor).request(input)).toBe('waiting')
  expect(mocks.enqueue).not.toHaveBeenCalled()
})

test('reports planning failures and client disconnects as unavailable', async () => {
  mocks.select.mockRejectedValue(new Error('database timeout'))
  const requester = createOnDemandProfileRequester(descriptor)
  expect(await requester.request(input)).toBe('unavailable')
  expect(await requester.request(input, AbortSignal.abort())).toBe('unavailable')
  expect(mocks.enqueue).not.toHaveBeenCalled()
})

test('shares one admission and wait among concurrent requests for the same type', async () => {
  const requester = createOnDemandProfileRequester(descriptor)
  const outcomes = await Promise.all([requester.request(input), requester.request(input)])
  expect(outcomes).toStrictEqual(['completed', 'completed'])
  expect(mocks.enqueue).toHaveBeenCalledOnce()
})

test('answers without waiting once the concurrent wait bound is reached', async () => {
  vi.useFakeTimers()
  mocks.getJobState.mockResolvedValue('active')
  const requester = createOnDemandProfileRequester(descriptor)
  const waiting = Array.from({ length: 16 }, (_, index) =>
    requester.request({ ...input, typeId: 100 + index }),
  )
  await vi.advanceTimersByTimeAsync(0)
  expect(await requester.request(input)).toBe('queued')
  await vi.advanceTimersByTimeAsync(3_000)
  expect(await Promise.all(waiting)).toStrictEqual(Array.from({ length: 16 }, () => 'collecting'))
})

test('bounds a stalled admission without canceling its accepted demand', async () => {
  vi.useFakeTimers()
  let release!: (value: readonly DueInstalledResource[]) => void
  const blocked = new Promise<readonly DueInstalledResource[]>((resolve) => {
    release = resolve
  })
  mocks.select.mockReturnValue(blocked)
  const waiting = createOnDemandProfileRequester(descriptor).request(input)
  await vi.advanceTimersByTimeAsync(5_000)
  expect(await waiting).toBe('waiting')
  expect(mocks.enqueue).not.toHaveBeenCalled()
  release([])
})
