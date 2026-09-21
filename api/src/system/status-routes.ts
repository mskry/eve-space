import { Hono } from 'hono'
import { getSystemStatus } from './status.js'

export const statusRoutes = new Hono().get('/', async (context) => {
  const status = await getSystemStatus()
  const { esiResilience } = status.services
  context.header('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
  return context.json(
    {
      ...status,
      services: {
        ...status.services,
        esiResilience: {
          ...esiResilience,
          upstream: {
            status: esiResilience.upstream.status,
            checkedAt: esiResilience.upstream.checkedAt,
          },
        },
      },
    },
    200,
  )
})
