import { Hono } from 'hono'

export const statusRoutes = new Hono().get('/', async (context) => context.json({ ok: true }))
