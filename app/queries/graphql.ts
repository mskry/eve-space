import { defineEsiQueryOptions } from '@eve-space/platform-module-nuxt/runtime'
import type { QueryCache } from '@pinia/colada'
import {
  executeTypedGraphQL,
  readGraphQLFieldError,
  type ApplicationGraphQLError,
  type GraphQLDocument,
} from '../graphql/graphql-client'
import {
  ExplorerMarketDocument,
  ExplorerOwnedAssetsDocument,
  ExplorerOwnedCharactersDocument,
  type ExplorerOwnedAssetsQueryVariables,
  type ExplorerOwnedCharactersQueryVariables,
} from '../generated/graphql-operations'
import { graphqlSchemaFingerprint } from '../generated/graphql-schema'
import type { GraphQLVariables } from '../graphql/graphql-values'
import { normalizeGraphQLVariables } from '../graphql/variables'
import { reportPrivateQueryAuthorizationDenial } from '../query-persistence/runtime'
import { isPositiveSafeInteger } from '../utils/number-guards'
import { createRequestSignal } from '../utils/request-signal'
import { PRIVATE_QUERY_KEYS } from './query-keys'

export interface GraphQLQueryContext {
  readonly baseUrl: string
  readonly queryCache: QueryCache
  readonly ownerUserId: string | null
  readonly characterId?: string
  readonly admissionKey: string | null
  readonly canRun: () => boolean
}

const scopedCharacterId = (context: GraphQLQueryContext) => {
  if (context.characterId === undefined) return undefined
  const characterId = Number(context.characterId)
  if (!isPositiveSafeInteger(characterId) || String(characterId) !== context.characterId)
    throw new Error('A canonical, safe character ID is required for a character-scoped query.')
  return characterId
}

const privateGraphQLQueryRoot = (context: GraphQLQueryContext) => {
  const characterId = scopedCharacterId(context)
  const scope =
    characterId === undefined
      ? PRIVATE_QUERY_KEYS.characters()
      : PRIVATE_QUERY_KEYS.character(characterId)
  return [...scope, 'graphql', context.ownerUserId, context.admissionKey]
}

export const applicationGraphQLQueryKey = (
  context: GraphQLQueryContext,
  operation: string,
  variables: GraphQLVariables,
  protectedRead: boolean,
) => {
  const root = protectedRead ? privateGraphQLQueryRoot(context) : ['public', 'graphql']
  return [
    ...root,
    graphqlSchemaFingerprint,
    operation,
    JSON.stringify(normalizeGraphQLVariables(variables)),
  ]
}

const ensureGraphQLAccess = (context: GraphQLQueryContext, signal: AbortSignal) => {
  signal.throwIfAborted()
  if (!context.canRun())
    throw new Error('Verify the live session and exact character before executing.')
}

const reportGraphQLAuthorizationDenials = async (
  context: GraphQLQueryContext,
  signal: AbortSignal,
  errors: readonly ApplicationGraphQLError[] = [],
) => {
  const authenticationError = errors.find(
    (error) => error.extensions?.code === 'AUTH_REQUIRED' || error.extensions?.status === 401,
  )
  const characterId = scopedCharacterId(context)
  const scope = { kind: 'character', characterId } as const
  const denials = await Promise.all(
    (authenticationError ? [authenticationError] : errors).map((error) =>
      readGraphQLFieldError(error),
    ),
  )
  ensureGraphQLAccess(context, signal)
  for (const denial of denials) {
    if (reportPrivateQueryAuthorizationDenial(context.queryCache, scope, denial)) return
  }
}

const typedApplicationGraphQLQuery = <Result, Variables extends GraphQLVariables>(
  context: GraphQLQueryContext,
  operation: string,
  document: GraphQLDocument<Result, Variables>,
  variables: Variables,
  protectedRead: boolean,
) =>
  defineEsiQueryOptions(() => ({
    key: applicationGraphQLQueryKey(context, operation, variables, protectedRead),
    query: async ({ signal }) => {
      ensureGraphQLAccess(context, signal)
      const requestSignal = createRequestSignal(16_000, signal)
      const result = await executeTypedGraphQL(context.baseUrl, document, variables, requestSignal)
      ensureGraphQLAccess(context, requestSignal)
      await reportGraphQLAuthorizationDenials(context, requestSignal, result.errors)
      return result
    },
    enabled: false,
    gcTime: 0,
    staleTime: 0,
    retry: 0,
    esiPersistence: { kind: 'none' },
  }))(undefined)

export const marketGraphQLQuery = (context: GraphQLQueryContext) =>
  typedApplicationGraphQLQuery(context, 'ExplorerMarket', ExplorerMarketDocument, {}, false)

export const ownedCharactersGraphQLQuery = (
  context: GraphQLQueryContext,
  variables?: ExplorerOwnedCharactersQueryVariables,
) =>
  typedApplicationGraphQLQuery(
    { ...context, characterId: undefined },
    'ExplorerOwnedCharacters',
    ExplorerOwnedCharactersDocument,
    variables ?? { after: null },
    true,
  )

export const ownedAssetsGraphQLQuery = (
  context: GraphQLQueryContext,
  variables: ExplorerOwnedAssetsQueryVariables,
) => {
  if (context.characterId !== variables.characterId)
    throw new Error('The query character must match the admitted character.')
  return typedApplicationGraphQLQuery(
    context,
    'ExplorerOwnedAssets',
    ExplorerOwnedAssetsDocument,
    variables,
    true,
  )
}
