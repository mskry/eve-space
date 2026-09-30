import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test, vi } from 'vitest'
import { installedModuleOnDemandResources } from '../../src/generated/platform/installed-module-on-demand.js'

const mocks = vi.hoisted(() => ({
  getStructureAuthorization: vi.fn(),
  createProducer: vi.fn(),
  enqueue: vi.fn(),
  close: vi.fn(),
}))
vi.mock('../../src/platform/structure-authority.js', () => ({
  getStructureAuthorization: mocks.getStructureAuthorization,
}))
vi.mock('../../src/queue/bullmq-producer.js', () => ({
  createBullMqQueueProducer: mocks.createProducer,
}))

import { createOnDemandStructureRequester } from '../../src/queue/on-demand-structure.js'

const descriptor = installedModuleOnDemandResources['market/private-structures']
const authority = {
  userId: randomUUID(),
  characterId: 90000001,
  subjectLifecycleId: randomUUID(),
  organizationVersion: 7,
}
const structureId = 1020000000000

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getStructureAuthorization.mockResolvedValue({ tokenVersion: 4 })
  mocks.createProducer.mockReturnValue({ enqueue: mocks.enqueue, close: mocks.close })
  mocks.enqueue.mockResolvedValue({ status: 'accepted' })
  mocks.close.mockResolvedValue(undefined)
})

test('enqueues only an exact authorized lifecycle and a bounded selector', async () => {
  const requester = createOnDemandStructureRequester(descriptor)
  expect(await requester.currentGeneration(authority)).toBe(4)
  expect(await requester.request(authority, structureId)).toBe('accepted')
  expect(mocks.enqueue).toHaveBeenCalledWith({
    name: 'module-structure-refresh',
    source: 'on-demand',
    materializationIntervalSeconds: 300,
    payload: expect.objectContaining({
      userId: authority.userId,
      subjectId: '90000001',
      subjectLifecycleId: authority.subjectLifecycleId,
      organizationVersion: 7,
      authorizationGeneration: 4,
      structureId,
    }),
  })
  expect(mocks.close).toHaveBeenCalledOnce()
  expect(JSON.stringify(mocks.enqueue.mock.calls)).not.toMatch(/price|order_id|token|secret/i)
})

test('refuses denied or malformed requests before queue admission', async () => {
  const requester = createOnDemandStructureRequester(descriptor)
  mocks.getStructureAuthorization.mockResolvedValue(null)
  expect(await requester.currentGeneration(authority)).toBeNull()
  expect(await requester.request(authority, structureId)).toBe('unavailable')
  expect(mocks.createProducer).not.toHaveBeenCalled()
  mocks.getStructureAuthorization.mockResolvedValue({ tokenVersion: 4 })
  expect(await requester.request(authority, 0)).toBe('unavailable')
  expect(mocks.createProducer).not.toHaveBeenCalled()
})
