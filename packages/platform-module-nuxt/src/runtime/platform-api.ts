import type { Hono } from 'hono'
import { hc } from 'hono/client'
import { toApiQueryError } from './query-error.js'

export interface PlatformApiHost {}

type PlatformApiApp = PlatformApiHost extends {
  readonly app: infer App extends Hono<any, any, any>
}
  ? App
  : never

export function createPlatformApiClient<App extends Hono<any, any, any> = PlatformApiApp>(
  baseUrl: string,
): ReturnType<typeof hc<App>> {
  return hc<App>(baseUrl, {
    init: { credentials: 'include' },
  })
}

export type PlatformApiClient = ReturnType<typeof createPlatformApiClient<PlatformApiApp>>

export type PlatformApiSuccessBody<Response> = Response extends {
  readonly ok: true
  json(): Promise<infer Body>
}
  ? Body
  : never

export async function readPlatformApiResponse<Response extends PlatformApiResponse>(
  response: Response,
  fallbackMessage: string,
): Promise<PlatformApiSuccessBody<Response>> {
  if (!response.ok) throw await toApiQueryError(response, fallbackMessage)
  return response.json() as Promise<PlatformApiSuccessBody<Response>>
}

interface PlatformApiResponse {
  readonly headers: Headers
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}
