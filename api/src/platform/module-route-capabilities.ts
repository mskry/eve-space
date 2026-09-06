import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract'
import { sql } from '../db/client.js'
import {
  createModulePersistenceCapability,
  type ModulePersistenceTransaction,
} from '../db/module-persistence.js'
import { sdeCoreReads } from './core-read-capabilities.js'
import { createPlatformModuleLogger } from './module-logging.js'

export function createPlatformModuleRouteCapabilities(
  moduleId: string,
): PlatformModuleRouteCapabilities<ModulePersistenceTransaction> {
  return {
    logger: createPlatformModuleLogger(moduleId),
    persistence: createModulePersistenceCapability(sql, moduleId),
    sde: sdeCoreReads,
  }
}
