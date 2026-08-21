import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { CharacterSummary, SessionAccount } from '../auth-store.js'
import { findOwnedCharacter } from '../auth-store.js'

export const characterIdParams = z.object({
  characterId: z
    .string()
    .regex(/^[1-9]\d*$/, 'Character ID must be a positive integer.')
    .transform(Number)
    .pipe(z.number().int().positive().safe('Character ID must be a positive integer.')),
})

export type OwnedCharacterEnv = {
  Variables: {
    session: SessionAccount | null
    ownedCharacter: CharacterSummary
  }
}

export const loadOwnedCharacter = createMiddleware<OwnedCharacterEnv>(async (context, next) => {
  const session = context.var.session
  if (!session) {
    return context.json({ code: 'AUTH_REQUIRED', message: 'Log in with EVE Online first.' }, 401)
  }

  const character = await findOwnedCharacter(
    session.userId,
    Number(context.req.param('characterId')),
  )
  if (!character) {
    return context.json({ code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' }, 404)
  }

  context.set('ownedCharacter', character)
  await next()
})
