export function createRawEsiTransport(
  configuration: { readonly userAgent: string; readonly compatibilityDate: string },
  options: { onResponseBodySettled?: () => void } = {},
): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('User-Agent', configuration.userAgent)
    headers.set('X-Compatibility-Date', configuration.compatibilityDate)
    const response = await globalThis.fetch(input, {
      ...init,
      headers,
    })
    return wrapEsiResponseBody(response, options.onResponseBodySettled)
  }
}

function wrapEsiResponseBody(response: Response, onSettled?: () => void) {
  if (!response.body) {
    onSettled?.()
    return response
  }
  return new Response(wrapResponseStream(response.body, onSettled), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function wrapResponseStream(body: ReadableStream<Uint8Array>, onSettled?: () => void) {
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
        controller.error(error)
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
