import { Hono } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { getCorporationPublic, getNpcCorporations } from './public-data.js'
import { corporationIdParams, limitPublicCorporationRequests } from './public-route-policy.js'
import { corporationResourceError, npcCorporationsError } from './route-responses.js'

export const corporationCoreRoutes = new Hono()
  .get('/npc', privateNoStore, limitPublicCorporationRequests, async (context) => {
    try {
      const corporationIds = await getNpcCorporations()
      return context.json({ corporationIds })
    } catch (error) {
      return npcCorporationsError(context, error)
    }
  })
  .get(
    '/:corporationId',
    privateNoStore,
    zValidator('param', corporationIdParams),
    limitPublicCorporationRequests,
    async (context) => {
      const { corporationId } = context.req.valid('param')
      try {
        const corporation = await getCorporationPublic(corporationId)
        return context.json({ corporation })
      } catch (error) {
        return corporationResourceError(
          context,
          error,
          'Corporation data is temporarily unavailable.',
        )
      }
    },
  )
