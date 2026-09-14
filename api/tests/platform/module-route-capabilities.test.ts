import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collectionStatus: { read: vi.fn() },
  createPlatformModuleActivityProviderPersistence: vi.fn(() => ({})),
  createPlatformModuleRoutePersistence: vi.fn(() => ({})),
  createPlatformResourceProjectionPersistence: vi.fn(() => ({})),
  createCoreDataCapability: vi.fn(),
  coreData: { publishedTypeGroups: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  providerPersistence: { readProviderSnapshot: vi.fn() },
  projectionPersistence: { readProjectionSnapshot: vi.fn() },
  routePersistence: { readRouteSnapshot: vi.fn() },
}))

vi.mock('../../src/core-data/capabilities.js', () => ({
  createCoreDataCapability: mocks.createCoreDataCapability,
}))
vi.mock('../../src/platform/module-collection-status-capabilities.js', () => ({
  createPlatformModuleCollectionStatusReads: vi.fn(() => mocks.collectionStatus),
}))
vi.mock('../../src/platform/module-logging.js', () => ({
  createPlatformModuleLogger: vi.fn(() => mocks.logger),
}))
vi.mock('../../src/platform/module-persistence-capabilities.js', () => ({
  createPlatformModuleRoutePersistence: mocks.createPlatformModuleRoutePersistence,
  createPlatformResourceProjectionPersistence: mocks.createPlatformResourceProjectionPersistence,
  createPlatformModuleActivityProviderPersistence:
    mocks.createPlatformModuleActivityProviderPersistence,
}))

import {
  createPlatformModuleRouteCapabilities,
  createPlatformResourceReadCapabilities,
} from '../../src/platform/module-route-capabilities.js'
import { createPlatformModuleActivityProviderCapabilities } from '../../src/platform/module-activity-provider-capabilities.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createPlatformModuleActivityProviderPersistence.mockReturnValue(mocks.providerPersistence)
  mocks.createPlatformModuleRoutePersistence.mockReturnValue(mocks.routePersistence)
  mocks.createPlatformResourceProjectionPersistence.mockReturnValue(mocks.projectionPersistence)
  mocks.createCoreDataCapability.mockImplementation((products: readonly string[]) =>
    products.includes('published-type-groups') ? mocks.coreData : {},
  )
})

describe('platform module route capabilities', () => {
  test('provides only declared product and persistence methods', () => {
    const capabilities = createPlatformModuleRouteCapabilities('alpha', 'alpha-route', [
      'published-type-groups',
    ] as const)

    expect(capabilities).toEqual({
      coreData: mocks.coreData,
      logger: mocks.logger,
      persistence: mocks.routePersistence,
    })
    expect(Object.keys(capabilities)).toEqual(['coreData', 'logger', 'persistence'])
    expect(mocks.createCoreDataCapability).toHaveBeenCalledWith(['published-type-groups'], 'route')
    expect(mocks.createPlatformModuleRoutePersistence).toHaveBeenCalledWith('alpha', 'alpha-route')
  })

  test('provides resource collectors read-only bounded persistence', () => {
    const capabilities = createPlatformResourceReadCapabilities({
      moduleId: 'alpha',
      resourceId: 'resource',
      operationId: 'operation',
      coreDataProducts: ['published-type-groups'],
      subjectKind: 'deployment',
      materializationIntervalSeconds: 60,
      eligibility: { kind: 'current-deployment' },
      implementation: {},
    })

    expect(capabilities).toEqual({
      coreData: mocks.coreData,
      logger: mocks.logger,
      persistence: mocks.projectionPersistence,
    })
    expect(mocks.createCoreDataCapability).toHaveBeenCalledWith(
      ['published-type-groups'],
      'resource-projection',
    )
    expect(mocks.createPlatformResourceProjectionPersistence).toHaveBeenCalledWith(
      'alpha',
      'resource',
      undefined,
    )
  })

  test('provides activity providers bounded status, logging, and persistence', () => {
    const controller = new AbortController()
    const context = {
      userId: 'user-1',
      organizationVersion: 7,
      requestedAt: '2026-09-06T12:00:00.000Z',
      signal: controller.signal,
      characters: [],
    }
    const capabilities = createPlatformModuleActivityProviderCapabilities(
      'alpha',
      'alpha-provider',
      context,
    )
    expect(Object.keys(capabilities)).toEqual([
      'collectionStatus',
      'coreData',
      'logger',
      'persistence',
    ])
    expect(capabilities.coreData).toEqual({})
    expect(mocks.createPlatformModuleActivityProviderPersistence).toHaveBeenCalledWith(
      'alpha',
      'alpha-provider',
      controller.signal,
      2000,
    )
  })
})
