import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  executeTypedGraphQL,
  readGraphQLFieldError,
  type GraphQLDocument,
} from '../src/runtime/graphql-client.js'
import { toGraphQLFieldError } from '../src/runtime/query-error.js'

const document: GraphQLDocument<{ value: string }, { id: string }> = {
  toString: () => 'query Value($id: ID!) { value(id: $id) }',
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('platform GraphQL transport', () => {
  it.each([
    {
      extensions: { status: 503, code: 'SOURCE_UNAVAILABLE' },
      status: 503,
      code: 'SOURCE_UNAVAILABLE',
    },
    {
      extensions: { status: '503', code: { value: 'SOURCE_UNAVAILABLE' } },
      status: 502,
      code: 'FIELD_UNAVAILABLE',
    },
    { extensions: { status: 600, code: null }, status: 502, code: 'FIELD_UNAVAILABLE' },
    { extensions: { status: 503.5, code: null }, status: 502, code: 'FIELD_UNAVAILABLE' },
  ])(
    'classifies external field metadata as status $status and code $code',
    ({ extensions, status, code }) => {
      expect(
        toGraphQLFieldError({ message: 'Unavailable', extensions }, 502, 'FIELD_UNAVAILABLE'),
      ).toMatchObject({ message: 'Unavailable', status, code })
    },
  )
  it('posts typed JSON to the configured endpoint and preserves partial data and safe errors', async () => {
    const envelope = {
      data: { value: '123456789012345678.12345' },
      errors: [
        {
          message: 'Unavailable',
          path: ['other'],
          extensions: { code: 'SOURCE_UNAVAILABLE', status: 503 },
        },
      ],
    }
    const fetch = vi.fn(async (_url, init: RequestInit) => {
      expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store' })
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/graphql-response+json',
      })
      expect(JSON.parse(String(init.body))).toEqual({
        query: document.toString(),
        variables: { id: '7' },
      })
      return Response.json(envelope)
    })
    vi.stubGlobal('fetch', fetch)
    expect(await executeTypedGraphQL('https://api.example.test/', document, { id: '7' })).toEqual(
      envelope,
    )
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.example.test/graphql')
    expect(await readGraphQLFieldError(envelope.errors[0]!)).toMatchObject({
      status: 503,
      code: 'SOURCE_UNAVAILABLE',
    })
  })

  it('retains rejected documents separately from host failures and malformed rejections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ errors: [{ message: 'Rejected' }] }, { status: 400 })),
    )
    expect(await executeTypedGraphQL('https://api.example.test', document, { id: '7' })).toEqual({
      errors: [{ message: 'Rejected' }],
    })
    for (const status of [400, 503]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ code: 'HOST_FAILURE' }, { status })),
      )
      await expect(
        executeTypedGraphQL('https://api.example.test', document, { id: '7' }),
      ).rejects.toMatchObject({ status, code: 'HOST_FAILURE' })
    }
  })

  it.each(['caller', 'deadline'])(
    'propagates %s cancellation through response consumption',
    async (cause) => {
      const caller = new AbortController()
      const deadline = new AbortController()
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, init: RequestInit) => {
          const signal = init.signal!
          return {
            ok: true,
            status: 200,
            json: () =>
              new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true })
                if (cause === 'caller') caller.abort()
                else deadline.abort(new DOMException('Deadline elapsed', 'TimeoutError'))
              }),
          }
        }),
      )
      await expect(
        executeTypedGraphQL('https://api.example.test', document, { id: '7' }, caller.signal),
      ).rejects.toMatchObject({ name: cause === 'caller' ? 'AbortError' : 'TimeoutError' })
      expect(timeout).toHaveBeenCalledWith(16_000)
    },
  )

  it.each(['caller', 'deadline'])(
    'rejects a late response that ignored %s cancellation',
    async (cause) => {
      const caller = new AbortController()
      const deadline = new AbortController()
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => {
            if (cause === 'caller') caller.abort()
            else deadline.abort(new DOMException('Deadline elapsed', 'TimeoutError'))
            return { data: { value: 'obsolete' } }
          },
        })),
      )
      await expect(
        executeTypedGraphQL('https://api.example.test', document, { id: '7' }, caller.signal),
      ).rejects.toMatchObject({ name: cause === 'caller' ? 'AbortError' : 'TimeoutError' })
    },
  )

  it('does not send an already cancelled request and propagates network failure', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Connection failed'))
    vi.stubGlobal('fetch', fetch)
    const caller = new AbortController()
    caller.abort()
    await expect(
      executeTypedGraphQL('https://api.example.test', document, { id: '7' }, caller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    await expect(
      executeTypedGraphQL('https://api.example.test', document, { id: '7' }),
    ).rejects.toThrow('Connection failed')
  })
})
