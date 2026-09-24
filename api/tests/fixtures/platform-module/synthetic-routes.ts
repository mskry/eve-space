import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformModuleRouteCapabilities,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { Hono } from 'hono'

export interface SyntheticModulePersistence {
  readModuleScope(): Promise<true>
}

export function createSyntheticSessionRoutes(
  capabilities: PlatformModuleRouteCapabilities<
    SyntheticModulePersistence,
    readonly ['published-type-groups']
  >,
) {
  return new Hono<PlatformAuthenticatedSessionRouteEnv>().get('/', async (context) => {
    const records = await capabilities.coreData.publishedTypeGroups({ typeIds: [] })
    return context.json({ authorization: context.var.platform.authorization, records }, 200)
  })
}

export function createSyntheticOwnedCharacterRoutes(
  capabilities: PlatformModuleRouteCapabilities<SyntheticModulePersistence>,
) {
  return new Hono<PlatformOwnedCharacterRouteEnv>().get('/', async (context) => {
    const affiliation = await context.var.platform.coreReads.loadAffiliation()
    const stored = await capabilities.persistence.readModuleScope()
    return context.json(
      { affiliation, authorization: context.var.platform.authorization, stored },
      200,
    )
  })
}
