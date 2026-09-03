import { z } from 'zod'
import { createPublicRequestRateLimit } from '../http/public-rate-limit.js'

export const corporationIdParams = z.object({
  corporationId: z.coerce.number().int().positive().max(2_147_483_647),
})

export const limitPublicCorporationRequests = createPublicRequestRateLimit({
  code: 'CORPORATION_RATE_LIMITED',
  message: 'Too many corporation requests.',
})
