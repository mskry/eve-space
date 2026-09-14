import type { PlatformInstalledPersistenceOperationDescriptor } from '@eve-space/platform-module-server'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import type postgres from 'postgres'
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
  createModulePersistenceOperationInvoker,
  ModulePersistenceOperationError,
  type ModulePersistenceOperationTransactionRunner,
} from '../../src/db/module-persistence-operation.js'

describe('module persistence operation executor', () => {
  test('executes only the fixed generated routine binding with validated JSON', async () => {
    const operation = descriptor()
    const { runInTransaction, runInTransactionSpy, unsafe } = transactionRunner([
      { result: { count: 3 } },
    ])
    const invoke = createModulePersistenceOperationInvoker([operation], runInTransaction)

    await expect(invoke(operation, { key: 'snapshot' })).resolves.toEqual({ count: 3 })
    expect(runInTransactionSpy).toHaveBeenCalledOnce()
    expect(runInTransactionSpy).toHaveBeenCalledWith(operation, expect.any(Function))
    expect(unsafe).toHaveBeenCalledWith(
      'select "eve_module_alpha"."persist_read_snapshot"($1::text::jsonb) as result',
      ['{"key":"snapshot"}'],
    )
  })

  test('rejects a descriptor that is not the generated binding object before a transaction', async () => {
    const operation = descriptor()
    const forged = { ...operation }
    const { runInTransaction, runInTransactionSpy } = transactionRunner([{ result: { count: 3 } }])
    const invoke = createModulePersistenceOperationInvoker([operation], runInTransaction)

    await expect(invoke(forged, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'binding',
    })
    expect(runInTransactionSpy).not.toHaveBeenCalled()
  })

  test('rejects invalid and oversized input before a transaction', async () => {
    const operation = descriptor({ maximumInputBytes: 24 })
    const { runInTransaction, runInTransactionSpy } = transactionRunner([{ result: { count: 3 } }])
    const invoke = createModulePersistenceOperationInvoker([operation], runInTransaction)

    await expect(invoke(operation, { key: 3 })).rejects.toMatchObject({ category: 'input' })
    await expect(invoke(operation, { key: 'x'.repeat(30) })).rejects.toMatchObject({
      category: 'input-size',
    })
    expect(runInTransactionSpy).not.toHaveBeenCalled()
  })

  test('rejects invalid, oversized, and malformed routine output', async () => {
    const invalid = descriptor()
    const invalidRunner = transactionRunner([{ result: { count: 'three' } }])
    const invalidInvoke = createModulePersistenceOperationInvoker(
      [invalid],
      invalidRunner.runInTransaction,
    )

    await expect(invalidInvoke(invalid, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'output',
    })

    const oversized = descriptor({ maximumOutputBytes: 12 })
    const oversizedRunner = transactionRunner([{ result: { count: 300 } }])
    const oversizedInvoke = createModulePersistenceOperationInvoker(
      [oversized],
      oversizedRunner.runInTransaction,
    )
    await expect(oversizedInvoke(oversized, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'output-size',
    })

    const malformedRunner = transactionRunner([])
    const malformedInvoke = createModulePersistenceOperationInvoker(
      [invalid],
      malformedRunner.runInTransaction,
    )
    await expect(malformedInvoke(invalid, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'output',
    })
  })

  test('enforces the transaction policy mode before execution', async () => {
    const operation = descriptor()
    const { runInTransaction, runInTransactionSpy } = transactionRunner([{ result: { count: 3 } }])
    const invoke = createModulePersistenceOperationInvoker([operation], runInTransaction, {
      expectedMode: 'write',
    })

    await expect(invoke(operation, { key: 'snapshot' })).rejects.toMatchObject({
      category: 'mode',
    })
    expect(runInTransactionSpy).not.toHaveBeenCalled()
  })

  test('cancels an in-flight routine query without exposing its database error', async () => {
    const operation = descriptor()
    const controller = new AbortController()
    let rejectQuery!: (error: unknown) => void
    const pending = new Promise<never>((_resolve, reject) => {
      rejectQuery = reject
    }) as Promise<never> & { cancel(): void }
    pending.cancel = vi.fn(() => rejectQuery(new Error('database-private-sentinel')))
    const unsafe = vi.fn(() => pending)
    const transaction = { unsafe } as unknown as postgres.TransactionSql
    const runInTransaction = createTransactionRunner(transaction)
    const invoke = createModulePersistenceOperationInvoker([operation], runInTransaction, {
      signal: controller.signal,
    })

    const result = invoke(operation, { key: 'snapshot' })
    controller.abort(new Error('abort-private-sentinel'))

    const failure = await result.catch((error: unknown) => error)
    expect(pending.cancel).toHaveBeenCalledOnce()
    expect(failure).toBeInstanceOf(ModulePersistenceOperationError)
    expect(failure).toMatchObject({
      moduleId: 'alpha',
      operationId: 'read-snapshot',
      category: 'cancelled',
    })
    expect(String(failure)).not.toContain('private-sentinel')
  })
})

function descriptor(
  bounds: { readonly maximumInputBytes?: number; readonly maximumOutputBytes?: number } = {},
): PlatformInstalledPersistenceOperationDescriptor {
  return {
    moduleId: 'alpha',
    operationId: 'read-snapshot',
    method: 'readSnapshot',
    revision: 1,
    mode: 'read',
    migration: 'alpha-001-read-snapshot.sql',
    schemaName: 'eve_module_alpha',
    routineName: 'persist_read_snapshot',
    definitionFingerprint: '0'.repeat(64),
    definition: definePlatformPersistenceOperation({
      id: 'read-snapshot',
      method: 'readSnapshot',
      revision: 1,
      mode: 'read',
      inputSchema: z.object({ key: z.string() }).strict(),
      outputSchema: z.object({ count: z.number() }).strict(),
      maximumInputBytes: bounds.maximumInputBytes ?? 1_024,
      maximumOutputBytes: bounds.maximumOutputBytes ?? 1_024,
    }),
    grants: {
      routes: ['activity'],
      activityProviders: [],
      resourceProjections: [],
      resourceMaterializations: [],
    },
  }
}

function transactionRunner(rows: readonly { readonly result: unknown }[]) {
  const query = Object.assign(Promise.resolve(rows), { cancel: vi.fn() })
  const unsafe = vi.fn(() => query)
  const transaction = { unsafe } as unknown as postgres.TransactionSql
  const runInTransactionSpy = vi.fn()
  const runInTransaction: ModulePersistenceOperationTransactionRunner = async <Result>(
    operation: PlatformInstalledPersistenceOperationDescriptor,
    execute: (transaction: postgres.TransactionSql) => Promise<Result>,
  ) => {
    runInTransactionSpy(operation, execute)
    return execute(transaction)
  }
  return { runInTransaction, runInTransactionSpy, unsafe }
}

function createTransactionRunner(
  transaction: postgres.TransactionSql,
): ModulePersistenceOperationTransactionRunner {
  return async <Result>(
    _operation: PlatformInstalledPersistenceOperationDescriptor,
    execute: (transaction: postgres.TransactionSql) => Promise<Result>,
  ) => execute(transaction)
}
