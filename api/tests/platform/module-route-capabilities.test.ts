import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collectionStatus: { read: vi.fn() },
  createModulePersistenceCapability: vi.fn(),
  createCoreDataCapability: vi.fn(),
  coreData: { publishedTypeGroups: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  persistence: { transaction: vi.fn() },
  sql: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ sql: mocks.sql }))
vi.mock('../../src/db/module-persistence.js', () => ({
  createModulePersistenceCapability: mocks.createModulePersistenceCapability,
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

import {
  createPlatformModuleRouteCapabilities,
  createPlatformResourceReadCapabilities,
} from '../../src/platform/module-route-capabilities.js'
import { createPlatformModuleActivityProviderCapabilities } from '../../src/platform/module-activity-provider-capabilities.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createModulePersistenceCapability.mockReturnValue(mocks.persistence)
  mocks.createCoreDataCapability.mockImplementation((products: readonly string[]) =>
    products.includes('published-type-groups') ? mocks.coreData : {},
  )
})

describe('platform module route capabilities', () => {
  test('provides only declared product methods and module-scoped persistence', async () => {
    const query = vi.fn().mockResolvedValue([{ type_id: 34 }])
    mocks.persistence.transaction.mockImplementation(async (operation) => operation({ query }))
    const capabilities = createPlatformModuleRouteCapabilities('alpha', [
      'published-type-groups',
    ] as const)

    expect(capabilities).toEqual({
      coreData: mocks.coreData,
      logger: mocks.logger,
      persistence: { transaction: expect.any(Function) },
    })
    expect(Object.keys(capabilities)).toEqual(['coreData', 'logger', 'persistence'])
    expect(mocks.createCoreDataCapability).toHaveBeenCalledWith(['published-type-groups'], 'route')
    expect(mocks.createModulePersistenceCapability).toHaveBeenCalledWith(mocks.sql, 'alpha')
    await expect(
      capabilities.persistence.transaction((transaction) =>
        transaction.query('select type_id from types', [34]),
      ),
    ).resolves.toEqual([{ type_id: 34 }])
    expect(query).toHaveBeenCalledWith('select type_id from types', [34])
  })

  test('provides resource collectors read-only bounded persistence', async () => {
    const query = vi.fn().mockResolvedValue([{ activity_id: 'one' }])
    mocks.persistence.transaction.mockImplementation(async (operation) => operation({ query }))

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

    await expect(
      capabilities.persistence.transaction((transaction) =>
        transaction.query('select activity_id from activities'),
      ),
    ).resolves.toEqual([{ activity_id: 'one' }])
    expect(capabilities).toEqual({
      coreData: mocks.coreData,
      logger: mocks.logger,
      persistence: { transaction: expect.any(Function) },
    })
    expect(mocks.createCoreDataCapability).toHaveBeenCalledWith(
      ['published-type-groups'],
      'resource-projection',
    )
    expect(mocks.createModulePersistenceCapability).toHaveBeenCalledWith(mocks.sql, 'alpha', {
      readOnly: true,
      statementTimeoutMilliseconds: 2_000,
    })
    expect(query).toHaveBeenCalledWith('select activity_id from activities')
  })

  test('provides activity providers bounded status, logging, and persistence', async () => {
    const query = vi.fn().mockResolvedValue([{ activity_id: 'one' }])
    mocks.persistence.transaction.mockImplementation(async (operation) => operation({ query }))
    const controller = new AbortController()
    const context = {
      userId: 'user-1',
      organizationVersion: 7,
      requestedAt: '2026-09-06T12:00:00.000Z',
      signal: controller.signal,
      characters: [],
    }
    const capabilities = createPlatformModuleActivityProviderCapabilities('alpha', context)
    let retainedTransaction: { query(statement: string): Promise<readonly object[]> } | undefined

    await expect(
      capabilities.persistence.transaction(async (transaction) => {
        retainedTransaction = transaction
        return transaction.query('select activity_id from activities', ['one'])
      }),
    ).resolves.toEqual([{ activity_id: 'one' }])

    expect(Object.keys(capabilities)).toEqual([
      'collectionStatus',
      'coreData',
      'logger',
      'persistence',
    ])
    expect(capabilities.coreData).toEqual({})
    expect(mocks.createModulePersistenceCapability).toHaveBeenCalledWith(mocks.sql, 'alpha', {
      assertActive: expect.any(Function),
      readOnly: true,
      statementTimeoutMilliseconds: 2000,
    })
    expect(query).toHaveBeenCalledWith('select activity_id from activities', ['one'])

    controller.abort()
    const options = mocks.createModulePersistenceCapability.mock.calls[0]![2]
    expect(() => options.assertActive()).toThrow('Module activity provider was aborted')
    expect(retainedTransaction).toBeDefined()
  })
})
