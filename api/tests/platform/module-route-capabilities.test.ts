import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collectionStatus: { read: vi.fn() },
  createModulePersistenceCapability: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  persistence: { transaction: vi.fn() },
  sdeCoreReads: { loadPublishedTypeGroups: vi.fn() },
  sql: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ sql: mocks.sql }))
vi.mock('../../src/db/module-persistence.js', () => ({
  createModulePersistenceCapability: mocks.createModulePersistenceCapability,
}))
vi.mock('../../src/platform/core-read-capabilities.js', () => ({
  sdeCoreReads: mocks.sdeCoreReads,
}))
vi.mock('../../src/platform/module-collection-status-capabilities.js', () => ({
  createPlatformModuleCollectionStatusReads: vi.fn(() => mocks.collectionStatus),
}))
vi.mock('../../src/platform/module-logging.js', () => ({
  createPlatformModuleLogger: vi.fn(() => mocks.logger),
}))

import { createPlatformModuleRouteCapabilities } from '../../src/platform/module-route-capabilities.js'
import { createPlatformModuleActivityProviderCapabilities } from '../../src/platform/module-activity-provider-capabilities.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createModulePersistenceCapability.mockReturnValue(mocks.persistence)
})

describe('platform module route capabilities', () => {
  test('provides only module-scoped persistence and bounded SDE reads', () => {
    const capabilities = createPlatformModuleRouteCapabilities('alpha')

    expect(capabilities).toEqual({
      logger: mocks.logger,
      persistence: mocks.persistence,
      sde: mocks.sdeCoreReads,
    })
    expect(Object.keys(capabilities)).toEqual(['logger', 'persistence', 'sde'])
    expect(mocks.createModulePersistenceCapability).toHaveBeenCalledWith(mocks.sql, 'alpha')
  })

  test('provides activity providers bounded status, logging, and persistence', async () => {
    const unsafe = vi.fn().mockResolvedValue([{ activity_id: 'one' }])
    mocks.persistence.transaction.mockImplementation(async (operation) => operation({ unsafe }))
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

    expect(Object.keys(capabilities)).toEqual(['collectionStatus', 'logger', 'persistence'])
    expect(mocks.createModulePersistenceCapability).toHaveBeenCalledWith(mocks.sql, 'alpha', {
      readOnly: true,
      statementTimeoutMilliseconds: 2000,
    })
    expect(unsafe).toHaveBeenCalledWith('select activity_id from activities', ['one'])
    await expect(retainedTransaction!.query('select 1')).rejects.toThrow(
      'Module activity transaction is no longer active',
    )

    controller.abort()
    await expect(capabilities.persistence.transaction(async () => undefined)).rejects.toThrow(
      'Module activity provider was aborted',
    )
  })
})
