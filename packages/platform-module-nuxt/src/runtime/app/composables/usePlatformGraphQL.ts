import { useRuntimeConfig } from '#imports'
import { executeTypedGraphQL, type GraphQLDocument } from '../../graphql-client.js'
import type { GraphQLVariables } from '../../graphql-values.js'

export const usePlatformGraphQL = () => {
  const baseUrl = useRuntimeConfig().public.apiBase
  return <Result, Variables extends GraphQLVariables>(
    document: GraphQLDocument<Result, Variables>,
    variables: NoInfer<Variables>,
    signal?: AbortSignal,
  ) => executeTypedGraphQL(baseUrl, document, variables, signal)
}
