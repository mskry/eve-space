export const ownedCharacterQuery = defineEsiQueryOptions(({ apiClient, characterId }) => ({
  key: ['owned-character', characterId],
  query: async ({ signal }) => {
    const response = await apiClient.api.me.characters[':characterId'].$get(
      { param: { characterId: String(characterId) } },
      { init: { signal } },
    )
    return response.json()
  },
  enabled: import.meta.client,
}))

export const mailHeadersQuery = defineEsiQueryOptions(({ apiClient, characterId }) => ({
  key: ['mail-headers', characterId],
  query: async ({ signal }) => {
    const response = await apiClient.api.me.characters[':characterId'].mail.$get(
      { param: { characterId: String(characterId) } },
      { init: { signal } },
    )
    return response.json()
  },
}))

export const statusQuery = defineEsiQueryOptions(({ apiClient }) => ({
  key: ['status'],
  query: async ({ signal }) => {
    const response = await apiClient.api.status.$get(undefined, { init: { signal } })
    return response.json()
  },
}))
