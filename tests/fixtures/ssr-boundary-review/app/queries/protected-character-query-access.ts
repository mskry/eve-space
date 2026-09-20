export function canRunProtectedCharacterQuery(access, characterId) {
  return access.isClient && access.authenticated && access.ownsCharacter && characterId > 0
}
