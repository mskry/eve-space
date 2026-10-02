import { findOwnedCharacter, type OwnedCharacterSummary } from './character-lifecycle.js'
import { findCharacterCacheAuthorizationForLifecycle } from './character-token-store.js'
import type { SessionAccount } from './session-store.js'
import { authRequiredBody } from '../http/contracts.js'
import type { ReadAdmissionDenial } from './read-policy.js'
import { schedulePendingCharacterTokenRecovery } from './tokens.js'
import { immediateReadWork, type ReadAdmissionWork } from './read-work.js'

export interface OwnedReadBinding {
  readonly userId: string
  readonly character: Readonly<OwnedCharacterSummary>
  readonly authorizationRevision: number
  readonly requiredScope?: string
}

export type OwnedCharacterAdmission =
  | ReadAdmissionDenial
  | {
      readonly admitted: true
      readonly character: OwnedCharacterSummary
    }
export type OwnedReadAdmission =
  | ReadAdmissionDenial
  | {
      readonly admitted: true
      readonly binding: OwnedReadBinding
    }

export const sessionAdmissionDenial = (
  session: SessionAccount | null,
): ReadAdmissionDenial | null =>
  session
    ? null
    : {
        admitted: false,
        status: 401,
        body: authRequiredBody,
      }

export const admitOwnedCharacter = async (
  session: SessionAccount | null,
  characterId: number,
  work: ReadAdmissionWork = immediateReadWork,
): Promise<OwnedCharacterAdmission> => {
  const denial = sessionAdmissionDenial(session)
  if (denial) return denial
  const character = await work.run(() => findOwnedCharacter(session!.userId, characterId))
  if (character?.characterId !== characterId)
    return {
      admitted: false,
      status: 404,
      body: { code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' },
    }
  return { admitted: true, character: Object.freeze({ ...character }) }
}

export const admitOwnedRead = async (
  session: SessionAccount | null,
  characterId: number,
  requiredScope?: string,
  work: ReadAdmissionWork = immediateReadWork,
): Promise<OwnedReadAdmission> => {
  const admission = await admitOwnedCharacter(session, characterId, work)
  if (!admission.admitted) return admission
  const authorization = await work.run(() =>
    findCharacterCacheAuthorizationForLifecycle(
      characterId,
      admission.character.subjectLifecycleId,
    ),
  )
  if (authorization?.pendingAttemptId) {
    schedulePendingCharacterTokenRecovery(characterId, admission.character.subjectLifecycleId)
    return {
      admitted: false,
      status: 503,
      body: {
        code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
        message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
      },
    }
  }
  if (!authorization)
    return {
      admitted: false,
      status: 403,
      body: {
        code: 'EVE_REAUTH_REQUIRED',
        message: 'EVE authorization is no longer valid.',
        requiredScope,
      },
    }
  if (requiredScope && !authorization.scopes.includes(requiredScope))
    return {
      admitted: false,
      status: 403,
      body: {
        code: 'EVE_SCOPE_REQUIRED',
        message: 'Authorize access for this character.',
        requiredScope,
      },
    }
  const current = await admitOwnedCharacter(session, characterId, work)
  if (!current.admitted) return current
  if (current.character.subjectLifecycleId !== admission.character.subjectLifecycleId)
    return {
      admitted: false,
      status: 409,
      body: {
        code: 'CHARACTER_AUTHORIZATION_CHANGED',
        message: 'Character authorization changed. Restart this read.',
      },
    }
  const binding = Object.freeze({
    userId: session!.userId,
    character: Object.freeze({ ...admission.character }),
    authorizationRevision: authorization.tokenVersion,
    requiredScope,
  })
  return { admitted: true, binding }
}

export const recheckOwnedRead = async (
  binding: OwnedReadBinding,
  session: SessionAccount | null,
  work: ReadAdmissionWork = immediateReadWork,
): Promise<ReadAdmissionDenial | null> => {
  const denial = sessionAdmissionDenial(session)
  if (denial) return denial
  if (session!.userId !== binding.userId)
    return {
      admitted: false,
      status: 409,
      body: {
        code: 'CHARACTER_AUTHORIZATION_CHANGED',
        message: 'Character authorization changed. Restart this read.',
      },
    }
  const admission = await admitOwnedRead(
    session,
    binding.character.characterId,
    binding.requiredScope,
    work,
  )
  if (!admission.admitted) return admission
  if (
    admission.binding.character.subjectLifecycleId !== binding.character.subjectLifecycleId ||
    admission.binding.authorizationRevision !== binding.authorizationRevision
  )
    return {
      admitted: false,
      status: 409,
      body: {
        code: 'CHARACTER_AUTHORIZATION_CHANGED',
        message: 'Character authorization changed. Restart this read.',
      },
    }
  return null
}
