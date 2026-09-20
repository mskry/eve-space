import { Hono } from 'hono'

export const mailRoutes = new Hono().get(
  '/:characterId/mail',
  loadSession,
  loadOwnedCharacter,
  async (context) => context.json({ messages: [] }),
)
