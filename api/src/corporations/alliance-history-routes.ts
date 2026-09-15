import { Hono } from 'hono'
import { toEsiReadResultMetadata } from '../esi-gateway/feature-execution.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { getCorporationAllianceHistoryResult } from './public-data.js'
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
      const result = await getCorporationAllianceHistoryResult(corporationId)
      return context.json({
        corporationId,
        history: result.data,
        ...toEsiReadResultMetadata(result),
      })
    } catch (error) {
      return corporationResourceError(
        context,
        error,
        'Alliance history is temporarily unavailable.',
      )
    }
  },
)
