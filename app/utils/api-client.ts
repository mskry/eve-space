import type { AppType } from '../../api/src/index'
import { createPlatformApiClient } from '@eve-space/platform-module-nuxt/runtime'

export function createApiClient(baseUrl: string) {
  return createPlatformApiClient<AppType>(baseUrl)
}

export type ApiClient = ReturnType<typeof createApiClient>
