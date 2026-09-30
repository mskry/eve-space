import { randomUUID } from 'node:crypto'
import { beforeEach, expect, test, vi } from 'vitest'
import { installedModuleOnDemandResources } from '../../src/generated/platform/installed-module-on-demand.js'
import type { PlatformCollectionStateIdentity } from '../../src/platform/collection-state.js'

const mocks = vi.hoisted(() => ({
  getStructureAuthorization: vi.fn(),
  processInstalledResourceRefresh: vi.fn(),
}))
vi.mock('../../src/platform/structure-authority.js', () => ({
  getStructureAuthorization: mocks.getStructureAuthorization,
}))
vi.mock('../../src/platform/resource-refresh.js', () => ({
  processInstalledResourceRefresh: mocks.processInstalledResourceRefresh,
}))

import { processInstalledStructureRefresh } from '../../src/platform/structure-refresh.js'

const descriptor = installedModuleOnDemandResources['market/private-structures']
const payload = {
  moduleId: 'market',
  resourceId: 'structure-orders',
  subjectKind: 'character' as const,
  subjectId: '90000001',
  subjectLifecycleId: randomUUID(),
  userId: randomUUID(),
  routeId: 'private-structures',
  admissionScope: descriptor.admissionScope,
  organizationVersion: 7,
  structureId: 1020000000000,
  authorizationGeneration: 4,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getStructureAuthorization.mockResolvedValue({ tokenVersion: 4 })
  mocks.processInstalledResourceRefresh.mockResolvedValue(undefined)
})

test('checks the exact installed route and authorization binding before collection', async () => {
  const signal = new AbortController().signal
  await processInstalledStructureRefresh({ ...payload, admissionScope: 'wrong' }, signal)
  await processInstalledStructureRefresh({ ...payload, resourceId: 'orders' }, signal)
  expect(mocks.getStructureAuthorization).not.toHaveBeenCalled()
  mocks.getStructureAuthorization.mockResolvedValueOnce({ tokenVersion: 5 })
  await processInstalledStructureRefresh(payload, signal)
  expect(mocks.processInstalledResourceRefresh).not.toHaveBeenCalled()
})

test('binds structure selection to character lifecycle and generation before and after ESI', async () => {
  let beforeApply: (() => Promise<boolean>) | undefined
  mocks.processInstalledResourceRefresh.mockImplementationOnce(
    async (
      _identity: PlatformCollectionStateIdentity,
      options: { beforeApply?: () => Promise<boolean> },
    ) => {
      beforeApply = options.beforeApply
    },
  )
  const signal = new AbortController().signal
  await processInstalledStructureRefresh(payload, signal)
  expect(mocks.processInstalledResourceRefresh).toHaveBeenCalledWith(
    {
      moduleId: 'market',
      resourceId: 'structure-orders',
      subjectKind: 'character',
      subjectId: '90000001',
      subjectLifecycleId: payload.subjectLifecycleId,
    },
    expect.objectContaining({
      selector: { structureId: payload.structureId },
      expectedAuthorizationGeneration: 4,
      expectedOrganizationVersion: 7,
      signal,
    }),
  )
  mocks.getStructureAuthorization.mockResolvedValueOnce(null)
  expect(await beforeApply?.()).toBe(false)
  expect(mocks.getStructureAuthorization).toHaveBeenCalledWith(descriptor, {
    userId: payload.userId,
    characterId: 90000001,
    subjectLifecycleId: payload.subjectLifecycleId,
    organizationVersion: 7,
  })
})
