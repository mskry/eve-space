import { Hono } from 'hono'
import { getSystemStatus } from '../system-status-service.js'

export const statusRoutes = new Hono().get('/', async (context) => {
  const status = await getSystemStatus()
  context.header('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
  return context.json(status, 200)
})
