export function prefetchProtectedQuery(queryCache, options, access, characterId) {
  if (characterId === undefined || !canRunProtectedCharacterQuery(access, characterId)) {
    return Promise.resolve()
  }
  return prefetchQuery(queryCache, options)
}
