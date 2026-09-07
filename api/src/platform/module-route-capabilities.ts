import type {
  PlatformModuleRouteCapabilities,
  PlatformModuleResourceCapabilities,
  PlatformModuleResourceTransaction,
} from '@eve-space/platform-module-contract'
import { withModuleQueryTransaction } from '../db/module-query-transaction.js'
import { sql } from '../db/client.js'
import { createModulePersistenceCapability } from '../db/module-persistence.js'
import { sdeCoreReads } from './core-read-capabilities.js'
import { createPlatformModuleLogger } from './module-logging.js'

export function createPlatformModuleRouteCapabilities(
  moduleId: string,
): PlatformModuleRouteCapabilities<PlatformModuleResourceTransaction> {
  const persistence = createModulePersistenceCapability(sql, moduleId)
  return {
    logger: createPlatformModuleLogger(moduleId),
    persistence: {
      transaction: (operation) =>
        persistence.transaction((transaction) =>
          withModuleQueryTransaction(transaction, operation),
        ),
    },
    sde: sdeCoreReads,
  }
}

export function createPlatformResourceReadCapabilities(
  moduleId: string,
): PlatformModuleResourceCapabilities {
  const persistence = createModulePersistenceCapability(sql, moduleId, {
    readOnly: true,
    statementTimeoutMilliseconds: 2_000,
  })
  return {
    logger: createPlatformModuleLogger(moduleId),
    sde: sdeCoreReads,
    persistence: {
      transaction: (operation) =>
        persistence.transaction((transaction) =>
          withModuleQueryTransaction(transaction, operation),
        ),
    },
  }
}
