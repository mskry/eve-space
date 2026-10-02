import { GraphQLError } from 'graphql'
import { expect, test, vi } from 'vitest'
import { GraphQLCachePolicy } from '../src/graphql/cache-policy.js'
import { graphQLResponse } from '../src/graphql/response.js'

const verdict = (policy: GraphQLCachePolicy, seconds: number, max = 60) =>
  policy.publicUntil(new Date(Date.now() + seconds * 1000).toISOString(), max)

test('takes the shortest declared remaining public lifetime and requires every backend verdict', () => {
  const policy = new GraphQLCachePolicy()
  verdict(policy, 120)
  verdict(policy, 20)
  expect(policy.header('GET', false, false)).toMatch(/^public, max-age=(19|20)$/)
  expect(policy.header('POST', false, false)).toBe('no-store')
  expect(policy.header('GET', true, false)).toBe('no-store')
  expect(policy.header('GET', false, true)).toBe('no-store')
  policy.field(true).finish()
  expect(policy.header('GET', false, false)).toBe('no-store')
})

test.each(['missing', 'stale', 'uncollected', 'incomplete', 'invalid'])(
  'never caches a %s verdict',
  (kind) => {
    const policy = new GraphQLCachePolicy()
    if (kind === 'stale') verdict(policy, -1)
    if (kind === 'invalid') policy.publicUntil('invalid', 30)
    if (kind === 'uncollected' || kind === 'incomplete') {
      verdict(policy, 30)
      policy.noStore()
    }
    expect(policy.header('GET', false, false)).toBe('no-store')
  },
)

test('caps serialized bytes and error counts without exposing messages or arbitrary extensions', async () => {
  const report = vi.fn()
  const oversized = graphQLResponse(
    { data: { value: '\u0000'.repeat(400000) } },
    'public, max-age=10',
    report,
  )
  expect(oversized.status).toBe(200)
  expect(oversized.headers.get('Cache-Control')).toBe('no-store')
  expect(await oversized.json()).toMatchObject({
    data: null,
    errors: [{ extensions: { code: 'OPERATION_LIMIT' } }],
  })
  const result = graphQLResponse(
    {
      data: { value: null },
      errors: Array.from(
        { length: 25 },
        () =>
          new GraphQLError('private'.repeat(1000), {
            path: ['value'],
            extensions: { code: 'UNTRUSTED_CODE', secret: 'private' },
          }),
      ),
    },
    'public, max-age=10',
    report,
  )
  const body = await result.json()
  expect(body.errors).toHaveLength(20)
  expect(JSON.stringify(body)).not.toContain('private')
  expect(report).toHaveBeenCalledOnce()
})
