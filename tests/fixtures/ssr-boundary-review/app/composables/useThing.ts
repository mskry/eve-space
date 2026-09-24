export function useThing(apiClient) {
  const spreadQuery = useQuery({
    ...mailHeadersQuery({ apiClient, characterId: 1 }),
    enabled: () => import.meta.client,
  })
  const grantMutation = useMutation({
    mutation: async (input) => {
      const response = await apiClient.api.me.characters[':characterId'].mail.$post({ json: input })
      return response.json()
    },
  })
  const returnedQuery = useQuery(() =>
    ownedCharacterQuery({
      apiClient,
      characterId: 2,
    }),
  )
  return { grantMutation, returnedQuery, spreadQuery }
}
