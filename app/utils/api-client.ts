import type { AppType } from '../../api/src/index'
import { hc } from 'hono/client'

export function createApiClient(baseUrl: string) {
  return hc<AppType>(baseUrl, {
    init: { credentials: 'include' },
  })
}

export type ApiClient = ReturnType<typeof createApiClient>
