import { Hono } from 'hono'
import { sql } from '../db/client.js'

export const healthRoutes = new Hono().get('/', async (context) => {
  try {
    await sql`select 1`
    return context.json({ database: 'connected', status: 'ok' })
  } catch {
    return context.json({ database: 'unavailable', status: 'error' }, 503)
  }
})
