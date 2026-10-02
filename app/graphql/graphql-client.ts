import { toApiQueryError } from '../utils/query-error.js'
import { isPositiveSafeInteger } from '../utils/number-guards.js'
import type { GraphQLJSONObject, GraphQLVariables } from './graphql-values.js'

export interface GraphQLDocument<Result, Variables> {
  readonly __apiType?: (variables: Variables) => Result
  toString(): string
}

export interface ApplicationGraphQLError {
  readonly message: string
  readonly path?: readonly (string | number)[]
  readonly extensions?: GraphQLJSONObject
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
  const status = error.extensions?.status
  return toApiQueryError(
    {
      status: isPositiveSafeInteger(status) && status >= 100 && status <= 599 ? status : 500,
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
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/graphql`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/graphql-response+json' },
    body: JSON.stringify(request),
    signal,
    cache: 'no-store',
  })
  if (!response.ok && response.status !== 400) {
    throw await toApiQueryError(response, 'GraphQL execution is unavailable.')
  }
  if (response.status === 400) {
    const result: ApplicationGraphQLResult<Result> = await response.clone().json()
    if (!Array.isArray(result.errors))
      throw await toApiQueryError(response, 'GraphQL request was rejected.')
    return result
  }
  return response.json()
}

export const executeTypedGraphQL = <Result, Variables extends GraphQLVariables>(
  baseUrl: string,
  document: GraphQLDocument<Result, Variables>,
  variables: NoInfer<Variables>,
  signal?: AbortSignal,
) => executeApplicationGraphQL<Result>(baseUrl, { query: document.toString(), variables }, signal)
