import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collectionStatus: { read: vi.fn() },
  coreData: { publishedTypeGroups: vi.fn() },
  createCoreDataCapability: vi.fn(),
  createPlatformModuleActivityProviderPersistence: vi.fn(() => ({})),
  createPlatformModuleRoutePersistence: vi.fn(() => ({})),
  createPlatformResourceProjectionPersistence: vi.fn(() => ({})),
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  projectionPersistence: { readProjectionSnapshot: vi.fn() },
  providerPersistence: { readProviderSnapshot: vi.fn() },
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
  createPlatformModuleActivityProviderPersistence:
    mocks.createPlatformModuleActivityProviderPersistence,
  createPlatformModuleRoutePersistence: mocks.createPlatformModuleRoutePersistence,
  createPlatformResourceProjectionPersistence: mocks.createPlatformResourceProjectionPersistence,
}))

import {
  createPlatformModuleRouteCapabilities,
  createPlatformReviewerContributionRouteCapabilities,
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

    expect(capabilities).toStrictEqual({
      coreData: mocks.coreData,
      logger: mocks.logger,
      persistence: mocks.routePersistence,
    })
    expect(Object.keys(capabilities)).toStrictEqual(['coreData', 'logger', 'persistence'])
    expect(mocks.createCoreDataCapability).toHaveBeenCalledWith(['published-type-groups'], 'route')
    expect(mocks.createPlatformModuleRoutePersistence).toHaveBeenCalledWith('alpha', 'alpha-route')
  })

  test('provides reviewer contributions only declared core reads and logging', () => {
    const capabilities = createPlatformReviewerContributionRouteCapabilities(
      {
        audience: 'hr',
        contributionId: 'overview',
        description: 'Review alpha.',
        icon: 'overview',
        label: 'Alpha',
        moduleId: 'alpha',
        order: 10,
        panelExport: './reviewer/overview',
        panelPackage: '@example/alpha-nuxt',
        publisherPackage: '@example/alpha-manifest',
        requiredPermission: 'alpha.review',
        routeId: 'alpha-route',
        routePath: '/api/modules/alpha/accounts/:userId',
        target: 'managed-organization-account',
      },
      ['published-type-groups'] as const,
    )

    expect(capabilities).toStrictEqual({ coreData: mocks.coreData, logger: mocks.logger })
    expect(capabilities).not.toHaveProperty('persistence')
    expect(mocks.createCoreDataCapability).toHaveBeenCalledWith(['published-type-groups'], 'route')
    expect(mocks.createPlatformModuleRoutePersistence).not.toHaveBeenCalled()
  })

  test('provides resource collectors read-only bounded persistence', () => {
    const capabilities = createPlatformResourceReadCapabilities({
      coreDataProducts: ['published-type-groups'],
      eligibility: { kind: 'current-deployment' },
      implementation: {},
      materializationIntervalSeconds: 60,
      moduleId: 'alpha',
      operationId: 'operation',
      resourceId: 'resource',
      subjectKind: 'deployment',
    })

    expect(capabilities).toStrictEqual({
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
      characters: [],
      organizationVersion: 7,
      requestedAt: '2026-09-06T12:00:00.000Z',
      signal: controller.signal,
      userId: 'user-1',
    }
    const capabilities = createPlatformModuleActivityProviderCapabilities(
      'alpha',
      'alpha-provider',
      context,
    )
    expect(Object.keys(capabilities)).toStrictEqual([
      'collectionStatus',
      'coreData',
      'logger',
      'persistence',
    ])
    expect(capabilities.coreData).toStrictEqual({})
    expect(mocks.createPlatformModuleActivityProviderPersistence).toHaveBeenCalledWith(
      'alpha',
      'alpha-provider',
      controller.signal,
      2000,
    )
  })
})
