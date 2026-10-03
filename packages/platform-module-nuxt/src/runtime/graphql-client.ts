import { toApiQueryError, toGraphQLFieldError } from './query-error.js'
import { createRequestSignal } from './request-signal.js'
import type { ApplicationGraphQLError, GraphQLVariables } from './graphql-values.js'

export type { ApplicationGraphQLError } from './graphql-values.js'

export interface GraphQLDocument<Result, Variables> {
  readonly __apiType?: (variables: Variables) => Result
  toString(): string
}

export interface ApplicationGraphQLResult<Result> {
  readonly data?: Result | null
  readonly errors?: readonly ApplicationGraphQLError[]
}

export interface ApplicationGraphQLRequest {
  readonly query: string
  readonly variables: GraphQLVariables
  readonly operationName?: string
}

export const readGraphQLFieldError = (error: ApplicationGraphQLError) => {
  return toApiQueryError(
    {
      status: toGraphQLFieldError(error).status,
      headers: new Headers(),
      json: async () => error.extensions ?? {},
    },
    error.message,
  )
}

const executeApplicationGraphQL = async <Result = unknown>(
  baseUrl: string,
  request: ApplicationGraphQLRequest,
  signal?: AbortSignal,
): Promise<ApplicationGraphQLResult<Result>> => {
  const requestSignal = createRequestSignal(16_000, signal)
  requestSignal.throwIfAborted()
  const response = await fetch(
    `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/api/graphql`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/graphql-response+json' },
      body: JSON.stringify(request),
      signal: requestSignal,
      cache: 'no-store',
    },
  )
  requestSignal.throwIfAborted()
  if (!response.ok && response.status !== 400) {
    throw await toApiQueryError(response, 'GraphQL execution is unavailable.')
  }
  if (response.status === 400) {
    const result: ApplicationGraphQLResult<Result> = await response.clone().json()
    requestSignal.throwIfAborted()
    if (!Array.isArray(result.errors))
      throw await toApiQueryError(response, 'GraphQL request was rejected.')
    return result
  }
  const result: ApplicationGraphQLResult<Result> = await response.json()
  requestSignal.throwIfAborted()
  return result
}

export const executeTypedGraphQL = <Result, Variables extends GraphQLVariables>(
  baseUrl: string,
  document: GraphQLDocument<Result, Variables>,
  variables: NoInfer<Variables>,
  signal?: AbortSignal,
) => executeApplicationGraphQL<Result>(baseUrl, { query: document.toString(), variables }, signal)
