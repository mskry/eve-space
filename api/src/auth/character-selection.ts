import { z } from 'zod'
import { pageUserCharacterIdentities } from './character-lifecycle.js'
import { sessionAdmissionDenial } from './read-admission.js'
import { assertReadAdmission, ReadAdmissionError } from './read-policy.js'
import type { ReadAdmissionWork } from './read-work.js'
import type { SessionAccount } from './session-store.js'

const cursorSchema = z.strictObject({
  version: z.literal(1),
  owner: z.string().min(1).max(64),
  after: z.int().positive(),
})

export class CharacterSelectionInputError extends Error {
  constructor() {
    super('Invalid character page. Restart the character selector.')
  }
}

const readPosition = (first: number, after: string | null, owner: string) => {
  if (!Number.isSafeInteger(first) || first < 1 || first > 50)
    throw new CharacterSelectionInputError()
  if (after === null) return 0
  try {
    if (after.length > 512 || !/^[\w-]+$/.test(after)) throw new CharacterSelectionInputError()
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(after, 'base64url').toString('utf8')))
    if (cursor.owner !== owner) throw new CharacterSelectionInputError()
    return cursor.after
  } catch {
    throw new CharacterSelectionInputError()
  }
}

export const readOwnedCharacterSelection = async (
  liveSession: () => Promise<SessionAccount | null>,
  first: number,
  after: string | null,
  work: ReadAdmissionWork,
) => {
  const session = await liveSession()
  assertReadAdmission(sessionAdmissionDenial(session))
  const position = readPosition(first, after, session!.userId)
  const page = await work.run(() => pageUserCharacterIdentities(session!.userId, first, position))
  const current = await liveSession()
  assertReadAdmission(sessionAdmissionDenial(current))
  if (current!.userId !== session!.userId)
    throw new ReadAdmissionError({
      admitted: false,
      status: 409,
      body: { code: 'CHARACTER_AUTHORIZATION_CHANGED', message: 'Restart the character selector.' },
    })
  const released = await work.run(() =>
    pageUserCharacterIdentities(current!.userId, first, position),
  )
  if (JSON.stringify(page) !== JSON.stringify(released)) throw new CharacterSelectionInputError()
  const last = page.items.at(-1)
  return {
    items: page.items,
    pageInfo: {
      hasNextPage: page.hasNextPage,
      restartRequired: false,
      endCursor:
        page.hasNextPage && last
          ? Buffer.from(
              JSON.stringify({ version: 1, owner: session!.userId, after: last.characterId }),
            ).toString('base64url')
          : null,
    },
  }
}
