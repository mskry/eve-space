import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createModulePersistenceCapability: vi.fn(),
  persistence: { transaction: vi.fn() },
  sdeCoreReads: { loadPublishedTypeGroups: vi.fn() },
  sql: vi.fn(),
}))

vi.mock('../src/db/client.js', () => ({ sql: mocks.sql }))
vi.mock('../src/db/module-persistence.js', () => ({
  createModulePersistenceCapability: mocks.createModulePersistenceCapability,
}))
vi.mock('../src/platform/core-read-capabilities.js', () => ({ sdeCoreReads: mocks.sdeCoreReads }))

import { createPlatformModuleRouteCapabilities } from '../src/platform/module-route-capabilities.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createModulePersistenceCapability.mockReturnValue(mocks.persistence)
})

describe('platform module route capabilities', () => {
  test('provides only module-scoped persistence and bounded SDE reads', () => {
    const capabilities = createPlatformModuleRouteCapabilities('alpha')

    expect(capabilities).toEqual({ persistence: mocks.persistence, sde: mocks.sdeCoreReads })
    expect(Object.keys(capabilities)).toEqual(['persistence', 'sde'])
    expect(mocks.createModulePersistenceCapability).toHaveBeenCalledWith(mocks.sql, 'alpha')
  })
})
