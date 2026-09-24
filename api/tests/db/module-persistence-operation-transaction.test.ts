import type { PlatformInstalledPersistenceOperationDescriptor } from '@eve-space/platform-module-server'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import type postgres from 'postgres'
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
  createStandaloneModulePersistenceOperationInvoker,
  createTransactionScopedModulePersistenceOperationInvoker,
} from '../../src/db/module-persistence-operation-transaction.js'

describe('standalone module persistence operation transactions', () => {
  test('runs writable route operations under the owning runtime role', async () => {
    const operation = descriptor('write')
    const database = fakeDatabase({ result: { applied: true } })
    const invoke = createStandaloneModulePersistenceOperationInvoker(database.connection, 'alpha', [
      operation,
    ])

    await expect(invoke(operation, { key: 'snapshot' })).resolves.toStrictEqual({ applied: true })
    expect(database.begin).toHaveBeenCalledOnce()
    expect(database.commands()).not.toContain('set transaction read only')
    expect(database.commands()).toContain('set local role')
    expect(database.commands()).toContain("select set_config('search_path', ")
  })

  test('applies read-only and statement-timeout policy to provider and projection operations', async () => {
    const operation = descriptor('read')
    const database = fakeDatabase({ result: { applied: true } })
    const invoke = createStandaloneModulePersistenceOperationInvoker(
      database.connection,
      'alpha',
      [operation],
      { readOnly: true, statementTimeoutMilliseconds: 2000 },
    )

    await expect(invoke(operation, { key: 'snapshot' })).resolves.toStrictEqual({ applied: true })
    expect(database.commands()).toContain('set transaction read only')
    expect(database.commands()).toContain("'statement_timeout'")
  })

  test('rejects write operations and invalid input before opening a read-only transaction', async () => {
    const write = descriptor('write')
    const read = descriptor('read')
    const database = fakeDatabase({ result: { applied: true } })
    const invoke = createStandaloneModulePersistenceOperationInvoker(
      database.connection,
      'alpha',
      [write, read],
      { readOnly: true },
    )

    await expect(invoke(write, { key: 'snapshot' })).rejects.toMatchObject({ category: 'mode' })
    await expect(invoke(read, { key: 42 })).rejects.toMatchObject({ category: 'input' })
    expect(database.begin).not.toHaveBeenCalled()
  })

  test('rejects another module binding before opening a transaction', async () => {
    const operation = descriptor('read', 'beta')
    const database = fakeDatabase({ result: { applied: true } })
    const invoke = createStandaloneModulePersistenceOperationInvoker(database.connection, 'alpha', [
      operation,
    ])

    await expect(invoke(operation, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'binding',
    })
    expect(database.begin).not.toHaveBeenCalled()
  })

  test('checks cancellation before opening and during a transaction', async () => {
    const operation = descriptor('read')
    const before = fakeDatabase({ result: { applied: true } })
    const beforeController = new AbortController()
    beforeController.abort()
    const beforeInvoke = createStandaloneModulePersistenceOperationInvoker(
      before.connection,
      'alpha',
      [operation],
      { signal: beforeController.signal },
    )

    await expect(beforeInvoke(operation, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'cancelled',
    })
    expect(before.begin).not.toHaveBeenCalled()

    const duringController = new AbortController()
    const during = fakeDatabase({ result: { applied: true } }, () => duringController.abort())
    const duringInvoke = createStandaloneModulePersistenceOperationInvoker(
      during.connection,
      'alpha',
      [operation],
      { signal: duringController.signal },
    )
    await expect(duringInvoke(operation, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'cancelled',
    })
  })
})

describe('transaction-scoped module persistence operations', () => {
  test('uses one savepoint and restores the platform role and search path', async () => {
    const operation = descriptor('write')
    const outer = fakeOuterTransaction({ result: { applied: true } })
    const scoped = createTransactionScopedModulePersistenceOperationInvoker(
      outer.transaction,
      'alpha',
      [operation],
    )

    await expect(scoped.invoke(operation, { key: 'snapshot' })).resolves.toStrictEqual({
      applied: true,
    })
    expect(outer.savepoint).toHaveBeenCalledOnce()
    expect(outer.commands()).toContain('set local role')
    expect(outer.commands()).toContain("set_config('search_path'")
    expect(scoped.suppressedFailure()).toBeUndefined()

    scoped.close()
    await expect(scoped.invoke(operation, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'inactive',
    })
  })

  test('rolls invalid output back to the savepoint and retains the first caught failure', async () => {
    const operation = descriptor('write')
    const outer = fakeOuterTransaction({ result: { applied: 'invalid' } })
    const scoped = createTransactionScopedModulePersistenceOperationInvoker(
      outer.transaction,
      'alpha',
      [operation],
    )

    const first = await scoped.invoke(operation, { key: 'snapshot' }).catch((error) => error)
    expect(first).toMatchObject({ category: 'output' })
    expect(outer.rolledBackToSavepoint()).toBe(true)
    await expect(scoped.invoke(operation, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'repeated',
    })
    expect(scoped.suppressedFailure()?.error).toBe(first)
  })

  test('allows each granted write operation once', async () => {
    const first = descriptor('write')
    const second = descriptor('write', 'alpha', 'write-index', 'writeIndex')
    const outer = fakeOuterTransaction({ result: { applied: true } })
    const scoped = createTransactionScopedModulePersistenceOperationInvoker(
      outer.transaction,
      'alpha',
      [first, second],
    )

    await expect(scoped.invoke(first, { key: 'snapshot' })).resolves.toStrictEqual({
      applied: true,
    })
    await expect(scoped.invoke(second, { key: 'snapshot' })).resolves.toStrictEqual({
      applied: true,
    })
    await expect(scoped.invoke(first, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'repeated',
    })
    expect(outer.savepoint).toHaveBeenCalledTimes(2)
  })

  test('rejects a retained unused operation after its materialization lifetime closes', async () => {
    const operation = descriptor('write')
    const outer = fakeOuterTransaction({ result: { applied: true } })
    const scoped = createTransactionScopedModulePersistenceOperationInvoker(
      outer.transaction,
      'alpha',
      [operation],
    )

    scoped.close()

    await expect(scoped.invoke(operation, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'inactive',
    })
    expect(outer.savepoint).not.toHaveBeenCalled()
  })
})

function descriptor(
  mode: 'read' | 'write',
  moduleId = 'alpha',
  operationId = `${mode}-snapshot`,
  method = `${mode}Snapshot`,
): PlatformInstalledPersistenceOperationDescriptor {
  return {
    definition: definePlatformPersistenceOperation({
      id: operationId,
      method,
      revision: 1,
      mode,
      inputSchema: z.object({ key: z.string() }).strict(),
      outputSchema: z.object({ applied: z.boolean() }).strict(),
      maximumInputBytes: 1024,
      maximumOutputBytes: 1024,
    }),
    definitionFingerprint: '0'.repeat(64),
    grants: {
      activityProviders: [],
      resourceMaterializations: [],
      resourceProjections: [],
      routes: [],
    },
    method,
    migration: `${moduleId}-001-${mode}-snapshot.sql`,
    mode,
    moduleId,
    operationId,
    revision: 1,
    routineName: `persist_${operationId.replaceAll('-', '_')}`,
    schemaName: `eve_module_${moduleId}`,
  }
}

function fakeDatabase(result: { readonly result: unknown }, afterFirstCommand?: () => void) {
  const statements: string[] = []
  let commandCount = 0
  const transaction = Object.assign(
    vi.fn((parts: TemplateStringsArray | string, ..._values: unknown[]) => {
      if (typeof parts === 'string') {
        return `"${parts}"`
      }
      statements.push(parts.join(' '))
      if (++commandCount === 1) {
        afterFirstCommand?.()
      }
      return Promise.resolve([])
    }),
    {
      unsafe: vi.fn(() => Object.assign(Promise.resolve([result]), { cancel: vi.fn() })),
    },
  )
  const begin = vi.fn(async (execute: (transaction: postgres.TransactionSql) => Promise<unknown>) =>
    execute(transaction as unknown as postgres.TransactionSql),
  )
  const connection = { begin } as unknown as postgres.Sql
  return { begin, commands: () => statements.join('\n'), connection }
}

function fakeOuterTransaction(result: { readonly result: unknown }) {
  const statements: string[] = []
  let rolledBack = false
  const transaction = Object.assign(
    vi.fn((parts: TemplateStringsArray | string, ..._values: unknown[]) => {
      if (typeof parts === 'string') {
        return `"${parts}"`
      }
      const statement = parts.join(' ')
      statements.push(statement)
      if (statement.includes('select current_user as role')) {
        return Promise.resolve([{ role: 'eve_space', searchPath: 'public' }])
      }
      return Promise.resolve([])
    }),
    {
      savepoint: vi.fn(
        async (execute: (transaction: postgres.TransactionSql) => Promise<unknown>) => {
          try {
            return await execute(transaction as unknown as postgres.TransactionSql)
          } catch (error) {
            rolledBack = true
            throw error
          }
        },
      ),
      unsafe: vi.fn(() => Object.assign(Promise.resolve([result]), { cancel: vi.fn() })),
    },
  )
  return {
    commands: () => statements.join('\n'),
    rolledBackToSavepoint: () => rolledBack,
    savepoint: transaction.savepoint,
    transaction: transaction as unknown as postgres.TransactionSql,
  }
}
