import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  invoke: vi.fn(),
  createInvoker: vi.fn(),
  coreData: vi.fn(),
  catalogue: vi.fn(),
}))
vi.mock('../../src/db/client.js', () => ({ sql: {} }))
vi.mock('../../src/db/module-persistence-operation-transaction.js', () => ({
  createStandaloneModulePersistenceOperationInvoker: boundary.createInvoker,
}))
vi.mock('../../src/core-data/capabilities.js', () => ({
  createCoreDataCapability: boundary.coreData,
}))
vi.mock('../../src/generated/platform/installed-module-persistence.js', () => ({
  installedModulePersistenceCapabilityFactories: {},
  installedModulePersistenceOperations: [
    {
      moduleId: 'alpha',
      operationId: 'read-book',
      revision: 1,
      method: 'readBook',
      mode: 'read',
      grants: { routes: ['book'], graphqlReads: ['book'] },
    },
    {
      moduleId: 'alpha',
      operationId: 'read-other',
      revision: 1,
      method: 'readOther',
      mode: 'read',
      grants: { routes: ['other'], graphqlReads: ['other'] },
    },
    {
      moduleId: 'alpha',
      operationId: 'write-book',
      revision: 1,
      method: 'writeBook',
      mode: 'write',
      grants: { routes: ['book'], graphqlReads: ['book'] },
    },
    {
      moduleId: 'beta',
      operationId: 'read-book',
      revision: 1,
      method: 'readBook',
      mode: 'read',
      grants: { routes: ['book'], graphqlReads: ['book'] },
    },
  ],
}))

import { createPlatformModuleReadPersistence } from '../../src/platform/module-persistence-capabilities.js'
import { createPlatformModuleReadCapabilities } from '../../src/platform/module-route-capabilities.js'
import type { ReadAdmissionWork } from '../../src/auth/read-work.js'
import { createDeferred } from '../support/deferred.js'

beforeEach(() => {
  boundary.createInvoker.mockReturnValue(boundary.invoke)
  boundary.invoke.mockResolvedValue({ observationId: 'observed' })
  boundary.catalogue.mockResolvedValue({ revision: 'pinned' })
  boundary.coreData.mockReturnValue({ marketCatalogue: boundary.catalogue })
})

describe('exact admitted module read capabilities', () => {
  it.each(['persistence', 'coreData'] as const)(
    'does not invoke queued %s work after admission is revoked',
    async (kind) => {
      const queued = createDeferred<void>()
      const acquired = createDeferred<void>()
      let admitted = true
      const guard = {
        assertCurrent: vi.fn(async () => {
          if (!admitted) throw new Error('Admission closed')
        }),
      }
      const work: ReadAdmissionWork = {
        run: async (read) => {
          queued.resolve()
          await acquired.promise
          return read()
        },
      }
      const capabilities = createPlatformModuleReadCapabilities(
        {
          moduleId: 'alpha',
          contributionId: 'book',
          grant: 'routes',
          operations: [{ operationId: 'read-book' }],
        },
        ['market-catalogue'] as const,
        guard,
        undefined,
        work,
      )
      const load =
        kind === 'persistence'
          ? () => capabilities.persistence.readBook!({})
          : () => capabilities.coreData.marketCatalogue({ kind: 'revision' })
      const result = load()
      await queued.promise
      admitted = false
      acquired.resolve()
      await expect(result).rejects.toThrow('Admission closed')
      expect(boundary.invoke).not.toHaveBeenCalled()
      expect(boundary.catalogue).not.toHaveBeenCalled()
    },
  )
  it.each(['routes', 'graphqlReads'] as const)(
    'constructs only declared %s reads with no composition I/O',
    async (grant) => {
      const signal = new AbortController().signal
      const guard = { assertCurrent: vi.fn(async () => undefined) }
      const capabilities = createPlatformModuleReadCapabilities(
        {
          moduleId: 'alpha',
          contributionId: 'book',
          grant,
          operations: [{ operationId: 'read-book' }],
        },
        ['market-catalogue'] as const,
        guard,
        signal,
      )
      expect(Object.keys(capabilities.persistence)).toEqual(['readBook'])
      expect(Object.keys(capabilities.coreData)).toEqual(['marketCatalogue'])
      expect(boundary.invoke).not.toHaveBeenCalled()
      expect(boundary.catalogue).not.toHaveBeenCalled()
      expect(guard.assertCurrent).not.toHaveBeenCalled()
      expect(boundary.createInvoker).toHaveBeenCalledWith(
        {},
        'alpha',
        [expect.objectContaining({ operationId: 'read-book' })],
        {
          readOnly: true,
          signal,
          statementTimeoutMilliseconds: 2000,
        },
      )
      const work = { typeId: 34 }
      expect(await capabilities.persistence.readBook!(work)).toEqual({ observationId: 'observed' })
      expect(boundary.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ moduleId: 'alpha', operationId: 'read-book' }),
        work,
      )
      expect(guard.assertCurrent).toHaveBeenCalledTimes(2)
      expect(Object.isFrozen(capabilities.persistence)).toBe(true)
      expect(Object.isFrozen(capabilities.coreData)).toBe(true)
    },
  )

  it.each(['write-book', 'read-other', 'unknown'])(
    'rejects %s before constructing an invoker',
    (operationId) => {
      expect(() =>
        createPlatformModuleReadPersistence({
          moduleId: 'alpha',
          contributionId: 'book',
          grant: 'graphqlReads',
          operations: [{ operationId }],
        }),
      ).toThrow('read-only persistence grant')
      expect(boundary.createInvoker).not.toHaveBeenCalled()
    },
  )

  it('rejects duplicate methods and never substitutes another module', () => {
    expect(() =>
      createPlatformModuleReadPersistence({
        moduleId: 'alpha',
        contributionId: 'book',
        grant: 'routes',
        operations: [{ operationId: 'read-book' }, { operationId: 'read-book' }],
      }),
    ).toThrow('duplicate')
    expect(() =>
      createPlatformModuleReadPersistence({
        moduleId: 'unknown',
        contributionId: 'book',
        grant: 'routes',
        operations: [{ operationId: 'read-book' }],
      }),
    ).toThrow('read-only persistence grant')
  })

  it('denies core-data and persistence work when the guard closes', async () => {
    const guard = {
      assertCurrent: vi.fn(async () => {
        throw new Error('Admission closed')
      }),
    }
    const capabilities = createPlatformModuleReadCapabilities(
      {
        moduleId: 'alpha',
        contributionId: 'book',
        grant: 'routes',
        operations: [{ operationId: 'read-book' }],
      },
      ['market-catalogue'] as const,
      guard,
    )
    await expect(capabilities.persistence.readBook!({})).rejects.toThrow('Admission closed')
    await expect(capabilities.coreData.marketCatalogue({ kind: 'revision' })).rejects.toThrow(
      'Admission closed',
    )
    expect(boundary.invoke).not.toHaveBeenCalled()
    expect(boundary.catalogue).not.toHaveBeenCalled()
  })
})
