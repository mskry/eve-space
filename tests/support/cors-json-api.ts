import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

interface JsonApiResponse {
  readonly status?: number
  readonly body: unknown
}

export async function startCorsJsonApi(
  handler: (request: IncomingMessage) => JsonApiResponse | Promise<JsonApiResponse>,
) {
  let allowedOrigin = 'http://127.0.0.1'
  const server = createServer(async (request, response) => {
    const headers = {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Content-Type': 'application/json',
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers)
      response.end()
      return
    }

    const result = await handler(request)
    response.writeHead(result.status ?? 200, headers)
    response.end(JSON.stringify(result.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${address.port}`,
    setAllowedOrigin(origin: string) {
      allowedOrigin = new URL(origin).origin
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
