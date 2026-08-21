import { Hono } from 'hono'
import { sql } from '../db/client.js'

export const healthRoutes = new Hono().get('/', async (context) => {
  try {
    await sql`select 1`
    return context.json({ status: 'ok', database: 'connected' })
  } catch {
    return context.json({ status: 'error', database: 'unavailable' }, 503)
  }
})
