import { createEveImages } from '@eve-space/platform-module-nuxt/runtime'

export type { EveImageSize, EveImageTenant } from '@eve-space/platform-module-nuxt/runtime'

export function useEveImages() {
  return createEveImages(String(useRuntimeConfig().public.eveImageBase))
}
