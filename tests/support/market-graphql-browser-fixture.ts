import type { GraphQLJSONObject } from '@eve-space/platform-module-nuxt/runtime'
import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { buildSchema, GraphQLError, isObjectType, isScalarType } from 'graphql'
import { createGraphQLHostAdapter } from '../../api/src/graphql/host-adapter.js'
import { applicationScalars } from '../../api/src/graphql/scalars.js'
import type { GraphQLFieldPolicy } from '../../api/src/graphql/execution-policy.js'
import { app } from './market-browser-fixture.mjs'

const root = new URL('../../', import.meta.url)
const schema = buildSchema(
  await readFile(new URL('api/src/generated/graphql/application.graphql', root), 'utf8'),
)
// SAFETY: registry build prerequisites validate the installed manifest and its GraphQL field policies.
const manifest = JSON.parse(
  await readFile(new URL('features/market/manifest/manifest.json', root), 'utf8'),
) as { server: { graphql: { reads: GraphQLFieldPolicy[] }[] } }
const policies = manifest.server.graphql[0]!.reads.map((read) =>
  Object.assign({}, read, { protected: false, projection: read.sourceCost === 0 }),
)
for (const [name, scalar] of Object.entries(applicationScalars)) {
  const target = schema.getType(name)
  if (isScalarType(target)) {
    target.serialize = scalar.serialize
    target.parseValue = scalar.parseValue
    target.parseLiteral = scalar.parseLiteral
  }
}
const read = async (path: string) => {
  const response = await app.request(`/api/modules/market/${path}`)
  const value = await response.json()
  if (!response.ok)
    throw new GraphQLError('Market fixture source unavailable.', { extensions: value })
  return value
}
const book = (args: { profileId: string; typeId: string }) =>
  read(`books/profiles/${args.profileId}/types/${args.typeId}/observation`)
let failSide = false
let rejectDocument = ''
let expiredObservation = false
let delayedType = ''
let delayMs = 0
let demandReady = false
let demandAccepted = false
let historyReads = 0

export const marketFixtureRequests: {
  query: string
  variables: GraphQLJSONObject
}[] = []
export const resetMarketGraphQLFixture = () => {
  marketFixtureRequests.length = 0
  marketFixtureHttpRequests.length = 0
  failSide = false
  rejectDocument = ''
  expiredObservation = false
  delayedType = ''
  delayMs = 0
  demandReady = false
  demandAccepted = false
  historyReads = 0
}
const market = schema.getType('MarketRead')
if (!isObjectType(market)) throw new Error('Missing installed Market schema.')
const fields = market.getFields()
schema.getQueryType()!.getFields().market!.resolve = () => ({})
fields.catalogueType!.resolve = async (_parent, args) => {
  const response = await read(`catalogue/body/${args.revision}/types/${args.typeId}`)
  return { revision: args.revision, item: response.item }
}
fields.profiles!.resolve = async () => (await read('books/profiles')).profiles
fields.book!.resolve = async (_parent, args) => {
  if (args.typeId === delayedType) await new Promise((resolve) => setTimeout(resolve, delayMs))
  return {
    ...(await book(args)),
    profileId: args.profileId,
    typeId: args.typeId,
    profileRevision: 1,
  }
}
const fixtureCursor = 'fixture-opaque-page-two'
fields.orders!.resolve = async (_parent, args) => {
  if (failSide && args.side === 'buy')
    throw new GraphQLError('Buyers unavailable.', {
      extensions: { code: 'MARKET_SIDE_UNAVAILABLE' },
    })
  if (expiredObservation && args.after)
    throw new GraphQLError('Observation unavailable.', {
      extensions: { code: 'MARKET_OBSERVATION_UNAVAILABLE' },
    })
  const state = await book(args)
  if (args.after && args.after !== fixtureCursor)
    throw new GraphQLError('Unexpected opaque continuation.')
  const side = args.side === 'sell' ? 'sellers' : 'buyers'
  const page = args.after
    ? await read(
        `books/profiles/${args.profileId}/types/${args.typeId}/observations/${args.observationId}/orders`,
      )
    : state[side]
  return {
    ...page,
    observationId: args.observationId,
    observation: state.observation,
    profileRevision: 1,
    nextCursor: page.hasMore ? fixtureCursor : null,
    labelsComplete: true,
  }
}
fields.history!.resolve = async (_parent, args) => {
  historyReads += 1
  if (demandAccepted && historyReads >= 3)
    await app.request('/__fixture/market-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: 'complete' }),
    })
  return {
    ...(await read(`history/profiles/${args.profileId}/types/${args.typeId}`)),
    profileId: args.profileId,
    profileRevision: 1,
  }
}
app.use('/api/graphql', async (context, next) => {
  const body = await context.req.raw.clone().json()
  marketFixtureRequests.push({
    query: body.query,
    variables: body.variables,
  })
  if (rejectDocument && body.query.includes(`query ${rejectDocument}`))
    return context.json(
      {
        errors: [
          { message: 'Rejected controlled document.', extensions: { code: 'BAD_USER_INPUT' } },
        ],
      },
      400,
    )
  const modules = await (await app.request('/api/modules')).json()
  if (!modules.enabledModuleIds.includes('market'))
    return context.json(
      { errors: [{ message: 'Market disabled.', extensions: { code: 'MODULE_UNAVAILABLE' } }] },
      400,
    )
  await next()
})
app.route(
  '/api/graphql',
  createGraphQLHostAdapter(schema, (request) => ({ signal: request.signal }), policies),
)
app.post('/__fixture/graphql-state', async (context) => {
  const state = await context.req.json()
  failSide = state.failSide ?? false
  rejectDocument = state.rejectDocument ?? ''
  expiredObservation = state.expiredObservation ?? false
  delayedType = state.delayedType ?? ''
  delayMs = state.delayMs ?? 0
  demandReady = state.demandReady ?? false
  demandAccepted = state.demandAccepted ?? false
  historyReads = 0
  return context.json({ updated: true })
})
app.post(
  '/api/modules/market/history-intent/profiles/:profileId/types/:typeId/demand',
  async (context) => {
    if (demandAccepted) return context.json({ status: 'accepted', phase: 'queued' }, 202)
    if (!demandReady) return context.json({ code: 'MARKET_HISTORY_SOURCE_UNAVAILABLE' }, 503)
    await app.request('/__fixture/market-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: 'complete' }),
    })
    return context.json({
      status: 'ready',
      history: await read(
        `history/profiles/${context.req.param('profileId')}/types/${context.req.param('typeId')}`,
      ),
    })
  },
)
export const marketFixtureHttpRequests: {
  path: string
  method: string
  cookie: string | null
}[] = []
export const marketGraphQLFixture = new Hono()
  .use('*', async (context, next) => {
    marketFixtureHttpRequests.push({
      path: context.req.path,
      method: context.req.method,
      cookie: context.req.header('cookie') ?? null,
    })
    await next()
  })
  .route('/', app)
