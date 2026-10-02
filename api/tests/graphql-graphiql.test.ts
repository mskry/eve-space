import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { buildSchema, getIntrospectionQuery } from 'graphql'
import { expect, test } from 'vitest'
import { createGraphQLHostAdapter } from '../src/graphql/host-adapter.js'
import { applicationGraphQLSchema, applicationGraphQLPolicies } from '../src/graphql/schema.js'
import { analyzeGraphQLSelection } from '../src/graphql/execution-policy.js'

test('serves a self-hosted GraphiQL page with host security headers', async () => {
  const app = new Hono().use('*', secureHeaders()).route(
    '/api/graphql',
    createGraphQLHostAdapter(
      buildSchema('type Query { independentField: String }'),
      (request) => ({ signal: request.signal }),
      [{ field: 'Query.independentField', protected: false, cost: 1, sourceCost: 0 }],
    ),
  )
  const response = await app.request('/api/graphql', { headers: { Accept: 'text/html' } })
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toContain('text/html')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  const html = await response.text()
  expect(html).toContain('EVE Space GraphiQL')
  expect(html).not.toContain('src="https://')
  expect(html).not.toContain('href="https://')
})

test('standard GraphiQL discovery fits the actual deployed schema limits', () => {
  const verdict = analyzeGraphQLSelection(
    applicationGraphQLSchema,
    getIntrospectionQuery({
      descriptions: true,
      specifiedByUrl: true,
      directiveIsRepeatable: true,
      inputValueDeprecation: true,
      schemaDescription: true,
    }),
    undefined,
    {},
    applicationGraphQLPolicies,
  )
  expect(verdict.private).toBe(true)
  expect(() =>
    analyzeGraphQLSelection(
      applicationGraphQLSchema,
      getIntrospectionQuery({ typeDepth: 17 }),
      undefined,
      {},
      applicationGraphQLPolicies,
    ),
  ).toThrow('Invalid or excessive')
})
