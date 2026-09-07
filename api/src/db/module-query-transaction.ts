import type { PlatformModuleResourceTransaction } from '@eve-space/platform-module-contract'
import type postgres from 'postgres'

export async function withModuleQueryTransaction<T>(
  transaction: postgres.TransactionSql,
  operation: (transaction: PlatformModuleResourceTransaction) => Promise<T>,
  assertActive: () => void = () => {},
) {
  let active = true
  try {
    assertActive()
    return await operation({
      async query<Row extends object>(statement: string, parameters: readonly unknown[] = []) {
        if (!active) throw new Error('Module query transaction is no longer active')
        assertActive()
        const rows = await transaction.unsafe(statement, [...parameters] as never[])
        return rows as unknown as readonly Row[]
      },
    })
  } finally {
    active = false
  }
}
