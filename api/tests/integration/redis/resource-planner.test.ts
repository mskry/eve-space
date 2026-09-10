import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { createBullMqQueueProducer } from '../../../src/queue/bullmq-producer.js'
import { operationsQueueName, queuePrefix } from '../../../src/queue/namespaces.js'
import { createOperationsQueueHandle } from '../../../src/queue/operations-queue.js'

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
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
    const handle = createOperationsQueueHandle({ connection })
    const queueProducer = createBullMqQueueProducer({ handle, plannerDelay: async () => 0 })
    const queue = handle.queue
    const workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null })
    const command = resourceCommand('1404328063')
    let release: (() => void) | undefined
    const active = new Promise<void>((resolve) => (release = resolve))
    let markSecondStarted: (() => void) | undefined
    const secondStarted = new Promise<void>((resolve) => (markSecondStarted = resolve))
    const secondActive = new Promise<void>(() => {})
    let invocations = 0
    const worker = new Worker(
      operationsQueueName,
      async () => {
        invocations += 1
        if (invocations === 1) return active
        markSecondStarted?.()
        return secondActive
      },
      { connection: workerConnection, prefix: queuePrefix },
    )
    try {
      await queueProducer.enqueue(command)
      await waitFor(async () => (await queue.getActiveCount()) === 1)
      const first = (await queue.getJobs(['active']))[0]
      expect(first?.opts).toMatchObject({
        attempts: 1,
        priority: 900,
        removeOnComplete: {
          age: expect.any(Number),
          count: expect.any(Number),
        },
        removeOnFail: {
          age: expect.any(Number),
          count: expect.any(Number),
        },
      })

      await queueProducer.enqueue(command)
      expect(await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized'])).toHaveLength(1)

      release?.()
      await waitFor(async () => (await queue.getCompletedCount()) === 1)

      await queueProducer.enqueue(command)
      await secondStarted
    } finally {
      await worker.close(true)
      await queue.obliterate({ force: true })
      await handle.close()
      await workerConnection.quit()
    }
  })

  test('batches capacity and deduplication reads for bulk publication', async () => {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
    const handle = createOperationsQueueHandle({ connection })
    const queueProducer = createBullMqQueueProducer({ handle, plannerDelay: async () => 0 })
    const capacityReads = vi.spyOn(handle.queue, 'getJobCounts')
    const deduplicationPipelines = vi.spyOn(connection, 'pipeline')
    const bulkWrites = vi.spyOn(handle.queue, 'addBulk')
    const commands = [resourceCommand('1404328063'), resourceCommand('1404328064')]
    try {
      await expect(queueProducer.enqueueMany(commands)).resolves.toEqual([
        { status: 'accepted', depth: 0 },
        { status: 'accepted', depth: 1 },
      ])
      expect(capacityReads).toHaveBeenCalledTimes(1)
      expect(deduplicationPipelines).toHaveBeenCalledTimes(2)
      expect(bulkWrites).toHaveBeenCalledTimes(1)

      capacityReads.mockClear()
      deduplicationPipelines.mockClear()
      bulkWrites.mockClear()
      await expect(queueProducer.enqueueMany(commands)).resolves.toEqual([
        { status: 'rejected', depth: 2, reason: 'coalesced' },
        { status: 'rejected', depth: 2, reason: 'coalesced' },
      ])
      expect(capacityReads).toHaveBeenCalledTimes(1)
      expect(deduplicationPipelines).toHaveBeenCalledTimes(1)
      expect(bulkWrites).not.toHaveBeenCalled()
      expect(await handle.queue.getJobs(['waiting', 'delayed', 'prioritized'])).toHaveLength(2)
    } finally {
      capacityReads.mockRestore()
      deduplicationPipelines.mockRestore()
      bulkWrites.mockRestore()
      await handle.queue.obliterate({ force: true })
      await handle.close()
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

function resourceCommand(subjectId: string) {
  return {
    name: 'resource-refresh',
    payload: {
      moduleId: resource.moduleId,
      resourceId: resource.resourceId,
      subjectKind: 'character' as const,
      subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
      subjectId,
    },
    source: 'planner',
    materializationIntervalSeconds: resource.materializationIntervalSeconds,
  } as const
}

async function waitFor(predicate: () => Promise<boolean>, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for BullMQ state')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
