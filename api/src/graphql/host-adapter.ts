import { Hono, type Context as HonoContext } from 'hono'
import { GraphQLError, type GraphQLSchema } from 'graphql'
import { createYoga, type Plugin } from 'graphql-yoga'
import {
  analyzeGraphQLSelection,
  type GraphQLFieldPolicy,
  type GraphQLSelectionVerdict,
} from './execution-policy.js'
import { GraphQLRequestState } from './request-state.js'
import { GraphQLCachePolicy } from './cache-policy.js'
import { graphQLResponse } from './response.js'
import { renderApplicationGraphiQL } from './graphiql.js'

export interface GraphQLHostContext {
  readonly signal: AbortSignal
}

export interface GraphQLTransportState {
  readonly work: GraphQLRequestState
  readonly cache: GraphQLCachePolicy
  readonly reportUnexpected: () => void
  selection?: GraphQLSelectionVerdict
}

const transportRejection = (request: Request): Response | undefined => {
  const headers = { 'Cache-Control': 'no-store' }
  if (request.method !== 'GET' && request.method !== 'POST')
    return Response.json(
      { message: 'Method not allowed.' },
      { status: 405, headers: { ...headers, Allow: 'GET, POST, OPTIONS' } },
    )
  if (
    request.method === 'POST' &&
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    return Response.json({ message: 'Use application/json.' }, { status: 415, headers })
  if (request.method === 'GET' && Buffer.byteLength(request.url) > 65_536)
    return Response.json({ message: 'Request is too large.' }, { status: 413, headers })
}

export const createGraphQLHostAdapter = <Context extends GraphQLHostContext>(
  schema: GraphQLSchema,
  createContext: (
    request: Request,
    transport: GraphQLTransportState,
    host: HonoContext,
  ) => Context | Promise<Context>,
  policies: readonly GraphQLFieldPolicy[],
  reportUnexpected: (host: HonoContext) => void = () => {},
) => {
  type Host = Context & { transport: GraphQLTransportState }
  const plugin: Plugin<Host, Host> = {
    onResultProcess: ({ setResultProcessor, serverContext, request }) => {
      setResultProcessor((result) => {
        const { transport } = serverContext
        if (Array.isArray(result) || Symbol.asyncIterator in result)
          return graphQLResponse(
            { errors: [new GraphQLError('Unsupported result.')] },
            'no-store',
            transport.reportUnexpected,
          )
        return graphQLResponse(
          result,
          transport.cache.header(
            request.method,
            transport.selection?.private ?? true,
            !!result.errors?.length,
          ),
          transport.reportUnexpected,
        )
      }, 'application/json')
    },
    onParams: ({ params, setResult, context }) => {
      try {
        context.transport.work.signal.throwIfAborted()
        context.transport.selection = analyzeGraphQLSelection(
          schema,
          params.query ?? '',
          params.operationName,
          params.variables ?? {},
          policies,
        )
      } catch {
        setResult({
          errors: [
            new GraphQLError('Invalid or excessive read operation.', {
              extensions: { code: 'BAD_USER_INPUT' },
            }),
          ],
        })
      }
    },
  }
  const yoga = createYoga<Context & { transport: GraphQLTransportState }>({
    batching: false,
    cors: false,
    graphiql: {
      title: 'EVE Space GraphiQL',
      credentials: 'include',
      method: 'POST',
      useGETForQueries: false,
      shouldPersistHeaders: false,
      maxHistoryLength: 0,
      // The bundled executor counts total attempts, so one disables retries.
      retry: 1,
      timeout: 16_000,
    },
    renderGraphiQL: renderApplicationGraphiQL,
    graphqlEndpoint: '/graphql',
    landingPage: false,
    logging: false,
    maskedErrors: { isDev: false },
    maxRequestBodySize: 65_536,
    multipart: false,
    parserAndValidationCache: false,
    plugins: [plugin],
    schema,
  })
  return new Hono().all('/', async (context) => {
    context.header('Cache-Control', 'no-store')
    const request = context.req.raw
    const rejection = transportRejection(request)
    if (rejection) return rejection
    const work = new GraphQLRequestState(request.signal)
    const transport: GraphQLTransportState = {
      work,
      cache: new GraphQLCachePolicy(),
      reportUnexpected: () => reportUnexpected(context),
    }
    const serverContext = await work.wait(
      Promise.resolve(createContext(request, transport, context)),
    )
    try {
      const response = await work.wait(
        Promise.resolve(yoga.fetch(request, { ...serverContext, transport })),
      )
      const cacheControl = response.headers.get('Cache-Control') ?? 'no-store'
      response.headers.set('Cache-Control', cacheControl)
      context.header('Cache-Control', cacheControl)
      return response
    } catch (error) {
      if (!work.signal.aborted) throw error
      const errors = [
        work.signal.reason instanceof GraphQLError
          ? work.signal.reason
          : new GraphQLError('Operation canceled or timed out.', {
              extensions: { code: 'OPERATION_CANCELED' },
            }),
      ]
      return graphQLResponse(
        { ...(transport.selection && { data: null }), errors },
        'no-store',
        transport.reportUnexpected,
      )
    }
  })
}
