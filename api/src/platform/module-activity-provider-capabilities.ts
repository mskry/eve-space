import type {
  PlatformActivityProviderContext,
  PlatformActivityProviderCapabilities,
  PlatformModuleResourceTransaction,
} from '@eve-space/platform-module-contract'
import { platformActivityProviderTimeoutMilliseconds } from '@eve-space/platform-module-contract'
import { withModuleQueryTransaction } from '../db/module-query-transaction.js'
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
        persistence.transaction((transaction) =>
          withModuleQueryTransaction(transaction, operation, () => {
            if (context.signal.aborted) throw new Error('Module activity provider was aborted')
          }),
        ),
    },
  }
}
