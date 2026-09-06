import { env } from '../env.js'
import { createProducerRedisConnection, type QueueRedisConnection } from '../queue/redis.js'

let coordinationConnection: QueueRedisConnection | undefined

export class EsiTransportError extends Error {
  constructor(
    cause: unknown,
    readonly status?: number,
  ) {
    super('ESI transport request failed', { cause })
    this.name = 'EsiTransportError'
  }
}

export function createRawEsiTransport(
  options: { onResponseBodySettled?: () => void } = {},
): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('User-Agent', env.ESI_USER_AGENT)
    headers.set('X-Compatibility-Date', env.ESI_COMPATIBILITY_DATE)
    const timeoutSignal = AbortSignal.timeout(env.ESI_REQUEST_TIMEOUT_MS)
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
    let response: Response
    try {
      response = await globalThis.fetch(input, {
        ...init,
        headers,
        signal,
      })
    } catch (error) {
      throw new EsiTransportError(error)
    }
    return wrapEsiResponseBody(response, options.onResponseBodySettled)
  }
}

function wrapEsiResponseBody(response: Response, onSettled?: () => void) {
  if (!response.body) {
    onSettled?.()
    return response
  }
  return new Response(wrapStreamErrors(response.body, response.status, onSettled), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function wrapStreamErrors(
  body: ReadableStream<Uint8Array>,
  status: number,
  onSettled?: () => void,
) {
  const reader = body.getReader()
  if (onSettled) void reader.closed.then(onSettled, onSettled)
  let released = false
  const release = () => {
    if (released) return
    released = true
    reader.releaseLock()
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          release()
          controller.close()
        } else controller.enqueue(result.value)
      } catch (error) {
        release()
        controller.error(new EsiTransportError(error, status))
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        release()
      }
    },
  })
}

export function getCoordinationConnection() {
  coordinationConnection ??= createProducerRedisConnection()
  return coordinationConnection
}
