import { Hono } from 'hono'
import { getSystemStatus } from './status.js'

export const statusRoutes = new Hono().get('/', async (context) => {
  const status = await getSystemStatus()
  context.header('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
  return context.json(status, 200)
})
