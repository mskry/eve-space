import { Hono } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { getCorporationAllianceHistory } from './public-data.js'
import { corporationIdParams, limitPublicCorporationRequests } from './public-route-policy.js'
import { corporationResourceError } from './route-responses.js'

export const corporationAllianceHistoryRoutes = new Hono().get(
  '/:corporationId/alliance-history',
  privateNoStore,
  zValidator('param', corporationIdParams),
  limitPublicCorporationRequests,
  async (context) => {
    const { corporationId } = context.req.valid('param')
    try {
      const history = await getCorporationAllianceHistory(corporationId)
      return context.json({ corporationId, history })
    } catch (error) {
      return corporationResourceError(
        context,
        error,
        'Alliance history is temporarily unavailable.',
      )
    }
  },
)
