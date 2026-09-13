import { describe, expect, it } from 'vitest'
import {
  canRunProtectedCharacterQuery,
  type ProtectedCharacterQueryAccess,
} from '../../app/queries/protected-character-query-access'

const allowed: ProtectedCharacterQueryAccess = {
  authenticated: true,
  authenticationReady: true,
  isClient: true,
  ownsCharacter: true,
}

describe('protected character query access', () => {
  it('allows only a ready authenticated browser owner with a positive safe character ID', () => {
    expect(canRunProtectedCharacterQuery(allowed, 7)).toBe(true)
    expect(canRunProtectedCharacterQuery({ ...allowed, isClient: false }, 7)).toBe(false)
    expect(canRunProtectedCharacterQuery({ ...allowed, authenticationReady: false }, 7)).toBe(false)
    expect(canRunProtectedCharacterQuery({ ...allowed, authenticated: false }, 7)).toBe(false)
    expect(canRunProtectedCharacterQuery({ ...allowed, ownsCharacter: false }, 7)).toBe(false)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed character ID %s',
    (characterId) => {
      expect(canRunProtectedCharacterQuery(allowed, characterId)).toBe(false)
    },
  )
})
