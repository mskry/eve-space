import { useRuntimeConfig } from '#imports'
import { createPlatformApiClient, type PlatformApiClient } from '../../platform-api.js'

export function usePlatformApi(): PlatformApiClient {
  return createPlatformApiClient(useRuntimeConfig().public.apiBase)
}
