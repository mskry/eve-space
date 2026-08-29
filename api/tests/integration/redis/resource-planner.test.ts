import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { runResourcePlanner } from '../../../src/queue/resource-planner.js'

let container: StartedTestContainer
let redisUrl: string

beforeAll(async () => {
  container = await new GenericContainer('redis:7.4.7-alpine')
    .withCommand(['redis-server', '--appendonly', 'yes', '--appendfsync', 'always'])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
  redisUrl = `redis://${container.getHost()}:${container.getMappedPort(6379)}`
})

afterAll(async () => {
  await container?.stop()
})

describe('generic resource planner BullMQ integration', () => {
  test('deduplicates active resource work and admits another refresh after completion', async () => {
    const queueName = `resource-planner-${crypto.randomUUID()}`
    const producer = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
    const queue = new Queue(queueName, { connection: producer })
    const workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null })
    const identity = {
      moduleId: resource.moduleId,
      resourceId: resource.resourceId,
      subjectKind: 'character' as const,
      subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
      subjectId: '1404328063',
    }
    const dependencies = {
      getCapacity: vi.fn().mockResolvedValue({ admitted: true, depth: 0, remainingCapacity: 1 }),
      selectDue: vi.fn().mockResolvedValue([{ identity, operationId: 'skills' }]),
      getCooldowns: vi
        .fn()
        .mockResolvedValue([
          { active: false, retryAfterSeconds: null, coordinationAvailable: true },
        ]),
      getInitialDelay: vi.fn().mockResolvedValue(0),
    }
    let release: (() => void) | undefined
    const active = new Promise<void>((resolve) => (release = resolve))
    let markSecondStarted: (() => void) | undefined
    const secondStarted = new Promise<void>((resolve) => (markSecondStarted = resolve))
    const secondActive = new Promise<void>(() => {})
    let invocations = 0
    const worker = new Worker(
      queueName,
      async () => {
        invocations += 1
        if (invocations === 1) return active
        markSecondStarted?.()
        return secondActive
      },
      { connection: workerConnection },
    )
    try {
      await runResourcePlanner(queue as never, undefined, { resources: [resource], dependencies })
      await waitFor(async () => (await queue.getActiveCount()) === 1)

      await runResourcePlanner(queue as never, undefined, { resources: [resource], dependencies })
      expect(await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized'])).toHaveLength(1)

      release?.()
      await waitFor(async () => (await queue.getCompletedCount()) === 1)

      await runResourcePlanner(queue as never, undefined, { resources: [resource], dependencies })
      await secondStarted
      expect(dependencies.getCooldowns).toHaveBeenCalledTimes(3)
    } finally {
      await worker.close(true)
      await queue.obliterate({ force: true })
      await queue.close()
      await producer.quit()
      await workerConnection.quit()
    }
  })
})

const resource = {
  moduleId: 'member-audit',
  resourceId: 'character-skills',
  operationId: 'skills',
  subjectKind: 'character',
  materializationIntervalSeconds: 900,
  eligibility: { kind: 'current-owned-character' },
  implementation: {},
} as const satisfies PlatformInstalledResourceDescriptor

async function waitFor(predicate: () => Promise<boolean>, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for BullMQ state')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
