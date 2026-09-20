import { Hono } from 'hono'

export const characterCoreRoutes = new Hono().get(
  '/:characterId',
  loadSession,
  loadOwnedCharacter,
  async (context) => context.json({ characterId: context.req.param('characterId') }),
)
