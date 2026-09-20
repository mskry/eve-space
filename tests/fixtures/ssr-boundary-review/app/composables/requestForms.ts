export function requestForms(apiClient, queryCache) {
  const mutation = useMutation({ mutation: async () => undefined })
  void prefetchProtectedQuery(queryCache, statusQuery(apiClient), {}, 1)
  void apiClient.api.status.$get()
  void $fetch('/api/status')
  return mutation
}
