import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, test, vi } from 'vitest'
import { executeEsiRequestAttempt } from '../../src/esi-gateway/internal/request-lifecycle.js'
import type { EsiRequestPermit } from '../../src/esi-gateway/internal/runtime-ports.js'

describe('Effect ESI request lifecycle', () => {
  test('does not acquire a permit when the SDK rejects before transport admission', async () => {
    const failure = new Error('request validation failed')
    const acquirePermit = vi.fn()

    await expect(
      executeEsiRequestAttempt({
        acquirePermit,
        createTransport: vi.fn(),
        attempt: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
    expect(acquirePermit).not.toHaveBeenCalled()
  })

  test('renews through body and observation settlement before releasing once', async () => {
    const clock = await createTestClock()
    const release = vi.fn().mockResolvedValue(undefined)
    const renew = vi.fn().mockResolvedValue(true)
    const headers = deferred<void>()
    const observation = deferred<void>()
    let settleBody!: () => void
    const pending = executeEsiRequestAttempt({
      clock,
      acquirePermit: async () => requestPermit({ release, renew }),
      createTransport: ({ onResponseBodySettled }) => {
        settleBody = onResponseBodySettled
        return async () => {
          headers.resolve()
          return new Response('{}')
        }
      },
      attempt: async (transport) => {
        await transport('https://esi.evetech.net/latest/status')
        await observation.promise
        return 'complete'
      },
    })

    await headers.promise
    await advance(clock, 50)
    await vi.waitFor(() => expect(renew).toHaveBeenCalledOnce())
    await advance(clock, 50)
    await vi.waitFor(() => expect(renew).toHaveBeenCalledTimes(2))
    settleBody()
    expect(release).not.toHaveBeenCalled()

    observation.resolve()
    await expect(pending).resolves.toBe('complete')
    expect(release).toHaveBeenCalledOnce()
    await advance(clock, 500)
    expect(renew).toHaveBeenCalledTimes(2)
  })

  test('settles an empty response body and preserves SDK failure identity', async () => {
    const sdkFailure = new Error('response validation failed')
    const release = vi.fn().mockResolvedValue(undefined)

    const pending = executeEsiRequestAttempt({
      acquirePermit: async () => requestPermit({ release }),
      createTransport:
        ({ onResponseBodySettled }) =>
        async () => {
          onResponseBodySettled()
          return new Response(null, { status: 204 })
        },
      attempt: async (transport) => {
        await transport('https://esi.evetech.net/latest/status')
        throw sdkFailure
      },
    })

    await expect(pending).rejects.toBe(sdkFailure)
    expect(release).toHaveBeenCalledOnce()
  })

  test.each([
    [
      'transport setup',
      (failure: Error) => () => {
        throw failure
      },
    ],
    ['fetch', (failure: Error) => () => async () => Promise.reject(failure)],
  ] as const)('releases after %s failure without replacing the error', async (_label, factory) => {
    const failure = new Error('transport failed')
    const release = vi.fn().mockResolvedValue(undefined)

    await expect(
      executeEsiRequestAttempt({
        acquirePermit: async () => requestPermit({ release }),
        createTransport: factory(failure),
        attempt: (transport) => transport('https://esi.evetech.net/latest/status'),
      }),
    ).rejects.toBe(failure)
    expect(release).toHaveBeenCalledOnce()
  })

  test('waits for an issued renewal before release when the body settles', async () => {
    const clock = await createTestClock()
    const renewal = deferred<boolean>()
    const renew = vi.fn(() => renewal.promise)
    const release = vi.fn().mockResolvedValue(undefined)
    let settleBody!: () => void
    const pending = executeEsiRequestAttempt({
      clock,
      acquirePermit: async () => requestPermit({ release, renew }),
      createTransport:
        ({ onResponseBodySettled }) =>
        async () => {
          settleBody = onResponseBodySettled
          return new Response('{}')
        },
      attempt: async (transport) => {
        await transport('https://esi.evetech.net/latest/status')
        return 'complete'
      },
    })

    await vi.waitFor(() => expect(settleBody).toBeTypeOf('function'))
    await advance(clock, 50)
    await vi.waitFor(() => expect(renew).toHaveBeenCalledOnce())
    settleBody()
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()

    renewal.resolve(true)
    await expect(pending).resolves.toBe('complete')
    expect(release).toHaveBeenCalledOnce()
  })

  test.each(['lost', 'rejected'] as const)(
    'aborts active body consumption when renewal is %s',
    async (outcome) => {
      const clock = await createTestClock()
      const renew = vi.fn(() =>
        outcome === 'lost' ? Promise.resolve(false) : Promise.reject(new Error('redis failed')),
      )
      const release = vi.fn().mockResolvedValue(undefined)
      let transportSignal: AbortSignal | undefined
      const pending = executeEsiRequestAttempt({
        clock,
        acquirePermit: async () => requestPermit({ release, renew }),
        createTransport:
          ({ onResponseBodySettled }) =>
          async (_input, init) => {
            transportSignal = init?.signal ?? undefined
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                transportSignal?.addEventListener(
                  'abort',
                  () => {
                    onResponseBodySettled()
                    controller.error(transportSignal?.reason)
                  },
                  { once: true },
                )
              },
            })
            return new Response(body)
          },
        attempt: async (transport) => {
          const response = await transport('https://esi.evetech.net/latest/status')
          return response.text()
        },
      })
      const caught = pending.catch((error: unknown) => error)

      await vi.waitFor(() => expect(transportSignal).toBeDefined())
      await advance(clock, 50)

      await expect(caught).resolves.toMatchObject({
        name: 'AbortError',
        message: 'ESI concurrency permit ownership lost',
      })
      expect(transportSignal?.aborted).toBe(true)
      expect(release).toHaveBeenCalledOnce()
    },
  )

  test('preserves cancellation and cleans a permit granted after interruption', async () => {
    const cancellation = new Error('caller cancelled')
    const controller = new AbortController()
    const grant = deferred<EsiRequestPermit>()
    const release = vi.fn().mockResolvedValue(undefined)
    const createTransport = vi.fn()
    let acquisitionSignal: AbortSignal | undefined
    const pending = executeEsiRequestAttempt({
      executionSignal: controller.signal,
      acquirePermit: (signal) => {
        acquisitionSignal = signal
        return grant.promise
      },
      createTransport,
      attempt: (transport) => transport('https://esi.evetech.net/latest/status'),
    })

    await vi.waitFor(() => expect(acquisitionSignal).toBeDefined())
    controller.abort(cancellation)
    expect(acquisitionSignal?.aborted).toBe(true)
    grant.resolve(requestPermit({ release }))

    await expect(pending).rejects.toBe(cancellation)
    expect(createTransport).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  test('does not begin acquisition when execution is already cancelled', async () => {
    const cancellation = new Error('caller cancelled')
    const controller = new AbortController()
    controller.abort(cancellation)
    const acquirePermit = vi.fn()

    await expect(
      executeEsiRequestAttempt({
        executionSignal: controller.signal,
        acquirePermit,
        createTransport: vi.fn(),
        attempt: vi.fn(),
      }),
    ).rejects.toBe(cancellation)
    expect(acquirePermit).not.toHaveBeenCalled()
  })

  test('holds the permit and cancels a response body that arrives after timeout', async () => {
    const timeout = new DOMException('request timed out', 'TimeoutError')
    const controller = new AbortController()
    const response = deferred<Response>()
    const transportStarted = deferred<void>()
    const cancel = vi.fn()
    const release = vi.fn().mockResolvedValue(undefined)
    const pending = executeEsiRequestAttempt({
      acquirePermit: async () => requestPermit({ release }),
      createTransport: () => async () => {
        transportStarted.resolve()
        return response.promise
      },
      attempt: async (transport) => {
        const request = transport('https://esi.evetech.net/latest/status', {
          signal: controller.signal,
        })
        return Promise.race([
          request,
          new Promise<Response>((_resolve, reject) =>
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
              once: true,
            }),
          ),
        ])
      },
    })
    const caught = pending.catch((error: unknown) => error)
    await transportStarted.promise

    controller.abort(timeout)
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()

    response.resolve(new Response(new ReadableStream<Uint8Array>({ cancel })))
    await expect(caught).resolves.toBe(timeout)
    expect(cancel).toHaveBeenCalledWith(timeout)
    expect(release).toHaveBeenCalledOnce()
  })

  test('records response metadata after body cancellation and before release', async () => {
    const timeout = new DOMException('request timed out', 'TimeoutError')
    const controller = new AbortController()
    const cooldownRecorded = deferred<void>()
    const events: string[] = []
    const release = vi.fn(async () => {
      events.push('permit released')
    })
    let transportSignal: AbortSignal | undefined
    const pending = executeEsiRequestAttempt({
      acquirePermit: async () => requestPermit({ release }),
      createTransport:
        ({ onResponseBodySettled }) =>
        async (_input, init) => {
          transportSignal = init?.signal ?? undefined
          return new Response(
            new ReadableStream<Uint8Array>({
              start(streamController) {
                transportSignal?.addEventListener(
                  'abort',
                  () => {
                    events.push('body cancelled')
                    onResponseBodySettled()
                    streamController.error(transportSignal?.reason)
                  },
                  { once: true },
                )
              },
            }),
            { status: 429 },
          )
        },
      attempt: async (transport) => {
        const response = await transport('https://esi.evetech.net/latest/status', {
          signal: controller.signal,
        })
        try {
          return await response.text()
        } catch (error) {
          await cooldownRecorded.promise
          events.push('cooldown recorded')
          throw error
        }
      },
    })
    const caught = pending.catch((error: unknown) => error)
    await vi.waitFor(() => expect(transportSignal).toBeDefined())

    controller.abort(timeout)
    await vi.waitFor(() => expect(events).toEqual(['body cancelled']))
    expect(release).not.toHaveBeenCalled()

    cooldownRecorded.resolve()
    await expect(caught).resolves.toBe(timeout)
    expect(events).toEqual(['body cancelled', 'cooldown recorded', 'permit released'])
    expect(release).toHaveBeenCalledOnce()
  })
})

function requestPermit(
  overrides: Partial<Pick<EsiRequestPermit, 'release' | 'renew'>> = {},
): EsiRequestPermit {
  return {
    coordinationAvailable: true,
    ttlMs: 100,
    renew: async () => true,
    release: async () => {},
    ...overrides,
  }
}

async function createTestClock() {
  return Effect.runPromise(Effect.scoped(TestClock.make({ warningDelay: '1 hour' })))
}

async function advance(clock: Awaited<ReturnType<typeof createTestClock>>, milliseconds: number) {
  await Effect.runPromise(clock.adjust(milliseconds))
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
