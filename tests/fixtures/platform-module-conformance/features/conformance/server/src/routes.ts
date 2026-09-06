import type {
  PlatformModuleRouteCapabilities,
  PlatformOwnedCharacterRouteEnv,
} from '@eve-space/platform-module-contract'
import { platformModuleError, zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'

const querySchema = z.object({ view: z.enum(['summary', 'conflict']) })

export function conformanceRoutes<Transaction>(
  capabilities: PlatformModuleRouteCapabilities<Transaction>,
) {
  return new Hono<PlatformOwnedCharacterRouteEnv>().get(
    '/',
    zValidator('query', querySchema),
    async (context) => {
      const { characterId } = context.var.platform.authorization
      const { view } = context.req.valid('query')
      if (view === 'conflict')
        throw platformModuleError(409, {
          code: 'CONFORMANCE_CONFLICT',
          message: 'The conformance activity is already current.',
        })

      const [resource, affiliation] = await Promise.all([
        context.var.platform.collectionStatus.read('conformance-status', {
          kind: 'character',
          characterId,
        }),
        context.var.platform.coreReads.loadAffiliation(),
      ])
      capabilities.logger.info('conformance.route.loaded', { characterId })
      return context.json(
        {
          characterId,
          corporationId: affiliation?.corporationId ?? null,
          organizationVersion: context.var.platform.organization.organizationVersion,
          resource,
          view,
        },
        200,
      )
    },
  )
}
