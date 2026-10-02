import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
import { secureHeaders } from 'hono/secure-headers'
import { createSchema } from 'graphql-yoga'
import type { GraphQLFieldResolver } from 'graphql'
import { describe, expect, it, vi } from 'vitest'
import { createGraphQLHostAdapter } from '../src/graphql/host-adapter.js'

const origin = 'http://localhost:3000'
const createFixture = (cost = 1) => {
  const read = vi.fn<
    GraphQLFieldResolver<object | undefined, { signal: AbortSignal }, Record<string, never>>
  >((_, __, context) => {
    context.signal.throwIfAborted()
    return 'ready'
  })
  const write = vi.fn(() => 'changed')
  const stream = vi.fn(async function* () {
    yield { updates: 'ready' }
  })
  const logged = vi.fn()
  const contexts: AbortSignal[] = []
  const schema = createSchema({
    typeDefs:
      'type Query { status: String } type Mutation { change: String } type Subscription { updates: String }',
    resolvers: {
      Query: { status: read },
      Mutation: { change: write },
      Subscription: { updates: { subscribe: stream } },
    },
  })
  const app = new Hono()
    .use('*', async (_, next) => {
      await next()
      logged()
    })
    .use('*', secureHeaders())
    .use('*', csrf({ origin }))
    .use('/api/*', cors({ credentials: true, origin }))
    .route(
      '/api/graphql',
      createGraphQLHostAdapter(
        schema,
        (request) => {
          contexts.push(request.signal)
          return { signal: request.signal }
        },
        [{ field: 'Query.status', protected: false, cost, sourceCost: 1 }],
      ),
    )
  return { app, contexts, logged, read, write, stream }
}

describe('GraphQL host adapter', () => {
  it('retains host security, logging, CORS and original cancellation', async () => {
    const fixture = createFixture()
    const controller = new AbortController()
    const request = new Request('http://localhost/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ query: '{ status }' }),
      signal: controller.signal,
    })
    const response = await fixture.app.fetch(request)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { status: 'ready' } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(fixture.contexts[0]).toBe(request.signal)
    expect(fixture.logged).toHaveBeenCalledOnce()
    controller.abort()
    expect(fixture.contexts[0]?.aborted).toBe(true)
  })

  it('uses host CSRF rejection and rejects unsupported methods/media', async () => {
    const { app, read } = createFixture()
    const rejected = await app.request('/api/graphql', {
      method: 'POST',
      headers: { Origin: 'http://untrusted', 'Content-Type': 'text/plain' },
      body: '{}',
    })
    expect(rejected.status).toBe(403)
    expect(
      (await app.request('/api/graphql', { method: 'PUT', headers: { Origin: origin } })).status,
    ).toBe(405)
    expect(
      (
        await app.request('/api/graphql', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'text/plain' },
          body: '{}',
        })
      ).status,
    ).toBe(415)
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects HTTP batches, oversized envelopes and invalid documents before reads', async () => {
    const { app, read } = createFixture()
    for (const body of ['[{"query":"{ status }"}]', JSON.stringify({ query: '{ unknown }' })]) {
      const response = await app.request('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      expect(response.status).toBe(400)
    }
    const response = await app.request('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ' '.repeat(65_537),
    })
    expect(response.status).toBe(413)
    expect(read).not.toHaveBeenCalled()
  })

  describe.each([
    'text/event-stream',
    'multipart/mixed',
    'text/event-stream, application/json;q=0.5',
    'multipart/mixed, application/graphql-response+json;q=0.5',
  ])('with Accept: %s', (accept) => {
    it.each(['GET', 'POST'])('returns non-streaming JSON for a valid %s query', async (method) => {
      const { app, read } = createFixture()
      const query = '{ status }'
      const path = `/api/graphql?query=${encodeURIComponent(query)}`
      const response = await app.request(path, {
        method,
        headers: { Accept: accept, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ query }) : undefined,
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({ data: { status: 'ready' } })
      expect(read).toHaveBeenCalledOnce()
    })

    it.each(['GET', 'POST'])(
      'returns a JSON validation error with HTTP 400 for %s',
      async (method) => {
        const { app, read } = createFixture()
        const query = '{ unknown }'
        const path = `/api/graphql?query=${encodeURIComponent(query)}`
        const response = await app.request(path, {
          method,
          headers: { Accept: accept, 'Content-Type': 'application/json' },
          body: method === 'POST' ? JSON.stringify({ query }) : undefined,
        })
        expect(response.status).toBe(400)
        expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(await response.json()).toMatchObject({ errors: [expect.any(Object)] })
        expect(read).not.toHaveBeenCalled()
      },
    )
  })

  it.each(['mutation { change }', 'subscription { updates }'])(
    'rejects non-read operation %s before execution',
    async (query) => {
      const { app, read, write, stream } = createFixture()
      const response = await app.request('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ query }),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        errors: [{ extensions: { code: 'BAD_USER_INPUT' } }],
      })
      expect(read).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(stream).not.toHaveBeenCalled()
    },
  )

  it('enforces field costs against the schema used for execution', async () => {
    const { app, read } = createFixture(5_000)
    const response = await app.request('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ query: '{ status }' }),
    })
    expect(response.status).toBe(400)
    expect(read).not.toHaveBeenCalled()
  })
})

it('bounds the entire operation even when a resolver ignores its deadline', async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  const timer = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(25))
  try {
    const { createDeferred } = await import('./support/deferred.js')
    const pending = createDeferred<string>()
    const schema = createSchema({
      typeDefs: 'type Query { slow: String }',
      resolvers: { Query: { slow: () => pending.promise } },
    })
    const app = new Hono().route(
      '/api/graphql',
      createGraphQLHostAdapter(schema, (_request, { work }) => ({ signal: work.signal }), [
        { field: 'Query.slow', protected: false, cost: 1, sourceCost: 1 },
      ]),
    )
    const response = await app.request('/api/graphql?query=%7Bslow%7D')
    expect(await response.json()).toMatchObject({
      data: null,
      errors: [{ extensions: { code: 'OPERATION_CANCELED' } }],
    })
    pending.resolve('late')
  } finally {
    timer.mockRestore()
  }
})
