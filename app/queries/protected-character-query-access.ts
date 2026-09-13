import { isPositiveSafeInteger } from '../utils/number-guards'

export interface ProtectedCharacterQueryAccess {
  readonly authenticated: boolean
  readonly authenticationReady: boolean
  readonly isClient: boolean
  readonly ownsCharacter: boolean
}

export function canRunProtectedCharacterQuery(
  access: ProtectedCharacterQueryAccess,
  characterId: number,
) {
  return (
    access.isClient &&
    access.authenticationReady &&
    access.authenticated &&
    access.ownsCharacter &&
    isPositiveSafeInteger(characterId)
  )
}
