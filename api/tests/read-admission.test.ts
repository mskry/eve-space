import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ owned: vi.fn(), authorization: vi.fn(), recover: vi.fn() }))
vi.mock('../src/auth/tokens.js', () => ({
  schedulePendingCharacterTokenRecovery: boundary.recover,
}))
vi.mock('../src/auth/character-lifecycle.js', () => ({ findOwnedCharacter: boundary.owned }))
vi.mock('../src/auth/character-token-store.js', () => ({
  findCharacterCacheAuthorizationForLifecycle: boundary.authorization,
}))

import {
  admitOwnedCharacter,
  admitOwnedRead,
  recheckOwnedRead,
} from '../src/auth/read-admission.js'
import { createAdmittedOwnedRead } from '../src/auth/admitted-read.js'
import { ReadAdmissionError } from '../src/auth/read-policy.js'

const character = {
  characterId: 90_000_001,
  name: 'Owner',
  corporationId: 1,
  allianceId: null,
  isMain: true,
  subjectLifecycleId: 'lifecycle-a',
}
const session = { userId: 'user-a', mainCharacter: character }

beforeEach(() => {
  boundary.owned.mockResolvedValue(character)
  boundary.authorization.mockResolvedValue({ tokenVersion: 3, scopes: ['assets'] })
})

describe('shared owned read admission', () => {
  it('rejects an unexpected subject returned by the ownership boundary', async () => {
    expect(await admitOwnedCharacter(session, 99)).toMatchObject({ admitted: false, status: 404 })
    expect(boundary.authorization).not.toHaveBeenCalled()
  })

  it('does not admit a lifecycle replaced during token admission', async () => {
    boundary.owned
      .mockResolvedValueOnce(character)
      .mockResolvedValueOnce({ ...character, subjectLifecycleId: 'new' })
    expect(await admitOwnedRead(session, character.characterId, 'assets')).toMatchObject({
      admitted: false,
      status: 409,
    })
  })

  it('preserves revoked authorization independently of missing scopes', async () => {
    boundary.authorization.mockResolvedValue(null)
    expect(await admitOwnedRead(session, character.characterId, 'assets')).toMatchObject({
      status: 403,
      body: { code: 'EVE_REAUTH_REQUIRED' },
    })
  })

  it('checks a captured read before reuse and before release without allowing subject substitution', async () => {
    const admission = await admitOwnedRead(session, character.characterId, 'assets')
    if (!admission.admitted) throw new Error('Expected admission')
    const load = vi.fn(async (binding) => {
      expect(binding.character.characterId).toBe(character.characterId)
      boundary.authorization.mockResolvedValue({ tokenVersion: 4, scopes: ['assets'] })
      return { private: 'inventory' }
    })
    const read = createAdmittedOwnedRead(admission.binding, async () => session, load)
    await expect(read.read(undefined)).rejects.toBeInstanceOf(ReadAdmissionError)
    await expect(read.assertCurrent()).rejects.toBeInstanceOf(ReadAdmissionError)
    expect(load).toHaveBeenCalledOnce()
    expect(Object.isFrozen(read)).toBe(true)
  })
  it('requires a live member session before ownership or tokens', async () => {
    expect(await admitOwnedRead(null, character.characterId, 'assets')).toMatchObject({
      admitted: false,
      status: 401,
    })
    expect(boundary.owned).not.toHaveBeenCalled()
    expect(boundary.authorization).not.toHaveBeenCalled()
  })

  it('keeps unknown and non-owned subjects indistinguishable', async () => {
    boundary.owned.mockResolvedValue(null)
    expect(await admitOwnedCharacter(session, 99)).toEqual({
      admitted: false,
      status: 404,
      body: { code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' },
    })
    expect(boundary.owned).toHaveBeenCalledWith('user-a', 99)
    expect(boundary.authorization).not.toHaveBeenCalled()
  })

  it('requires the exact scope and freezes the admitted subject', async () => {
    expect(await admitOwnedRead(session, character.characterId, 'wallet')).toMatchObject({
      admitted: false,
      status: 403,
      body: { requiredScope: 'wallet' },
    })
    const admission = await admitOwnedRead(session, character.characterId, 'assets')
    expect(admission.admitted).toBe(true)
    if (!admission.admitted) throw new Error('Expected admission')
    expect(Object.isFrozen(admission.binding)).toBe(true)
    expect(Object.isFrozen(admission.binding.character)).toBe(true)
    expect(await recheckOwnedRead(admission.binding, session)).toBeNull()
  })

  it.each(['transfer', 'lifecycle', 'revision'])(
    'denies delayed data after %s changes',
    async (change) => {
      const admission = await admitOwnedRead(session, character.characterId, 'assets')
      if (!admission.admitted) throw new Error('Expected admission')
      if (change === 'transfer') boundary.owned.mockResolvedValue(null)
      if (change === 'lifecycle')
        boundary.owned.mockResolvedValue({ ...character, subjectLifecycleId: 'lifecycle-b' })
      if (change === 'revision')
        boundary.authorization.mockResolvedValue({ tokenVersion: 4, scopes: ['assets'] })
      expect(await recheckOwnedRead(admission.binding, session)).toMatchObject({ admitted: false })
    },
  )

  it('closes admission for pending credential rotation and for a lost or changed session', async () => {
    const admission = await admitOwnedRead(session, character.characterId, 'assets')
    if (!admission.admitted) throw new Error('Expected admission')
    expect(await recheckOwnedRead(admission.binding, null)).toMatchObject({ status: 401 })
    expect(
      await recheckOwnedRead(admission.binding, { ...session, userId: 'other' }),
    ).toMatchObject({ status: 409 })
    boundary.authorization.mockResolvedValue({
      tokenVersion: 3,
      scopes: ['assets'],
      pendingAttemptId: 'rotation',
    })
    expect(await recheckOwnedRead(admission.binding, session)).toMatchObject({ status: 503 })
    expect(boundary.recover).toHaveBeenCalledWith(
      character.characterId,
      character.subjectLifecycleId,
    )
    expect(boundary.authorization).toHaveBeenCalledWith(
      character.characterId,
      character.subjectLifecycleId,
    )
  })
})
