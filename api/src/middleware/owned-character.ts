import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type { OwnedCharacterSummary } from '../auth/character-lifecycle.js'
import { admitOwnedCharacter } from '../auth/read-admission.js'
import type { SessionAccount } from '../auth/session-store.js'

export const characterIdParams = z.object({
  characterId: z
    .string()
    .regex(/^[1-9]\d*$/, 'Character ID must be a positive integer.')
    .transform(Number)
    .pipe(z.number().int().positive('Character ID must be a positive integer.')),
})

export type OwnedCharacterEnv = {
  Variables: {
    session: SessionAccount | null
    ownedCharacter: OwnedCharacterSummary
  }
}

export const loadOwnedCharacter = createMiddleware<OwnedCharacterEnv>(async (context, next) => {
  const admission = await admitOwnedCharacter(
    context.var.session,
    Number(context.req.param('characterId')),
  )
  if (!admission.admitted) {
    return context.json(admission.body, admission.status)
  }

  context.set('ownedCharacter', admission.character)
  await next()
})
