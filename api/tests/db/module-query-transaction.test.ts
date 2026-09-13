import type postgres from 'postgres'
import { describe, expect, test, vi } from 'vitest'
import {
  ModuleQueryValidationError,
  withModuleQueryTransaction,
} from '../../src/db/module-query-transaction.js'

const options = {
  moduleId: 'alpha',
  schemaName: 'eve_module_alpha',
}

describe('module query transactions', () => {
  test('executes validated statements with copied parameters', async () => {
    const rows = [{ value: 'kept' }]
    const unsafe = vi.fn().mockResolvedValue(rows)
    const parameters = ['kept']

    await expect(
      withModuleQueryTransaction(
        transaction(unsafe),
        (query) => query.query('select value from records where value = $1', parameters),
        options,
      ),
    ).resolves.toEqual(rows)

    expect(unsafe).toHaveBeenCalledWith('select value from records where value = $1', ['kept'])
    expect(unsafe.mock.calls[0]![1]).not.toBe(parameters)
  })

  test.each([
    ['reset role', 'prohibited-operation'],
    ['reset session authorization', 'prohibited-operation'],
    ['set role none', 'prohibited-operation'],
    ["select set_config('role', 'none', true)", 'prohibited-operation'],
    ["do $$ begin execute 'reset role'; end $$", 'prohibited-operation'],
    ['select * from public.users', 'cross-schema'],
    ['insert into eve_module_beta.records default values', 'cross-schema'],
  ])('rejects identity or schema escape SQL before execution: %s', async (statement, category) => {
    const unsafe = vi.fn()

    await expect(
      withModuleQueryTransaction(transaction(unsafe), (query) => query.query(statement), options),
    ).rejects.toMatchObject({ category, moduleId: 'alpha' })
    expect(unsafe).not.toHaveBeenCalled()
  })

  test('rolls back a validation failure even when module code catches it', async () => {
    const unsafe = vi.fn().mockResolvedValue([])

    await expect(
      withModuleQueryTransaction(
        transaction(unsafe),
        async (query) => {
          await query.query('reset role').catch(() => undefined)
          await query.query("insert into records (value) values ('rolled back')")
        },
        options,
      ),
    ).rejects.toBeInstanceOf(ModuleQueryValidationError)
    expect(unsafe).toHaveBeenCalledOnce()
  })

  test('retains database failures and expires the transaction after the operation', async () => {
    const failure = new Error('database failure')
    const unsafe = vi.fn().mockRejectedValue(failure)
    let retained: { query(statement: string): Promise<readonly object[]> } | undefined

    await expect(
      withModuleQueryTransaction(
        transaction(unsafe),
        async (query) => {
          retained = query
          await query.query('select value from records').catch(() => undefined)
        },
        options,
      ),
    ).rejects.toBe(failure)
    await expect(retained!.query('select value from records')).rejects.toThrow(
      'Module query transaction is no longer active',
    )
  })
})

function transaction(unsafe: ReturnType<typeof vi.fn>) {
  return { unsafe } as unknown as postgres.TransactionSql
}
