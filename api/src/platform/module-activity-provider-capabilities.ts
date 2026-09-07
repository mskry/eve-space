import type {
  PlatformActivityProviderContext,
  PlatformActivityProviderCapabilities,
  PlatformModuleResourceTransaction,
} from '@eve-space/platform-module-contract'
import { platformActivityProviderTimeoutMilliseconds } from '@eve-space/platform-module-contract'
import { sql } from '../db/client.js'
import { createModulePersistenceCapability } from '../db/module-persistence.js'
import { createPlatformModuleCollectionStatusReads } from './module-collection-status-capabilities.js'
import { createPlatformModuleLogger } from './module-logging.js'

export function createPlatformModuleActivityProviderCapabilities(
  moduleId: string,
  context: PlatformActivityProviderContext,
): PlatformActivityProviderCapabilities<PlatformModuleResourceTransaction> {
  const persistence = createModulePersistenceCapability(sql, moduleId, {
    readOnly: true,
    statementTimeoutMilliseconds: platformActivityProviderTimeoutMilliseconds,
  })
  return {
    collectionStatus: createPlatformModuleCollectionStatusReads({
      moduleId,
      organizationVersion: context.organizationVersion,
      characters: context.characters,
      signal: context.signal,
    }),
    logger: createPlatformModuleLogger(moduleId),
    persistence: {
      transaction: (operation) =>
        persistence.transaction(async (transaction) => {
          if (context.signal.aborted) throw new Error('Module activity provider was aborted')
          let active = true
          const resourceTransaction: PlatformModuleResourceTransaction = {
            async query<Row extends object>(statement: string, parameters = []) {
              if (!active) throw new Error('Module activity transaction is no longer active')
              if (context.signal.aborted) throw new Error('Module activity provider was aborted')
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
