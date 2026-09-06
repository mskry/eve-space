import type {
  PlatformActivityProviderCapabilities,
  PlatformModuleResourceTransaction,
} from '@eve-space/platform-module-contract'
import { platformActivityProviderTimeoutMilliseconds } from '@eve-space/platform-module-contract'
import { sql } from '../db/client.js'
import { createModulePersistenceCapability } from '../db/module-persistence.js'

export function createPlatformModuleActivityProviderCapabilities(
  moduleId: string,
  signal: AbortSignal,
): PlatformActivityProviderCapabilities<PlatformModuleResourceTransaction> {
  const persistence = createModulePersistenceCapability(sql, moduleId, {
    readOnly: true,
    statementTimeoutMilliseconds: platformActivityProviderTimeoutMilliseconds,
  })
  return {
    persistence: {
      transaction: (operation) =>
        persistence.transaction(async (transaction) => {
          if (signal.aborted) throw new Error('Module activity provider was aborted')
          let active = true
          const resourceTransaction: PlatformModuleResourceTransaction = {
            async query<Row extends object>(statement: string, parameters = []) {
              if (!active) throw new Error('Module activity transaction is no longer active')
              if (signal.aborted) throw new Error('Module activity provider was aborted')
              const rows = await transaction.unsafe(statement, [...parameters] as never[])
              return rows as unknown as readonly Row[]
            },
          }
          try {
            return await operation(resourceTransaction)
          } finally {
            active = false
          }
        }),
    },
  }
}
