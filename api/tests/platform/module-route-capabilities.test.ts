import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createModulePersistenceCapability: vi.fn(),
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

import { createPlatformModuleRouteCapabilities } from '../../src/platform/module-route-capabilities.js'
import { createPlatformModuleActivityProviderCapabilities } from '../../src/platform/module-activity-provider-capabilities.js'

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

  test('provides activity providers only transaction-scoped module persistence', async () => {
    const unsafe = vi.fn().mockResolvedValue([{ activity_id: 'one' }])
    mocks.persistence.transaction.mockImplementation(async (operation) => operation({ unsafe }))
    const controller = new AbortController()
    const capabilities = createPlatformModuleActivityProviderCapabilities(
      'alpha',
      controller.signal,
    )
    let retainedTransaction: { query(statement: string): Promise<readonly object[]> } | undefined

    await expect(
      capabilities.persistence.transaction(async (transaction) => {
        retainedTransaction = transaction
        return transaction.query('select activity_id from activities', ['one'])
      }),
    ).resolves.toEqual([{ activity_id: 'one' }])

    expect(Object.keys(capabilities)).toEqual(['persistence'])
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
