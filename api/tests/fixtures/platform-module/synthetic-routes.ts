import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformModuleRouteCapabilities,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { Hono } from 'hono'

export interface SyntheticModuleTransaction {
  readonly moduleScoped: true
}

export function createSyntheticSessionRoutes(
  capabilities: PlatformModuleRouteCapabilities<SyntheticModuleTransaction>,
) {
  return new Hono<PlatformAuthenticatedSessionRouteEnv>().get('/', async (context) => {
    const records = await capabilities.sde.loadPublishedTypeGroups([])
    return context.json({ authorization: context.var.platform.authorization, records }, 200)
  })
}

export function createSyntheticOwnedCharacterRoutes(
  capabilities: PlatformModuleRouteCapabilities<SyntheticModuleTransaction>,
) {
  return new Hono<PlatformOwnedCharacterRouteEnv>().get('/', async (context) => {
    const affiliation = await context.var.platform.coreReads.loadAffiliation()
    const stored = await capabilities.persistence.transaction(
      async (transaction) => transaction.moduleScoped,
    )
    return context.json(
      { authorization: context.var.platform.authorization, affiliation, stored },
      200,
    )
  })
}
