import { useRuntimeConfig } from '#imports'
import { createEveImages } from '../../eve-images.js'

export function usePlatformEveImages() {
  return createEveImages(String(useRuntimeConfig().public.eveImageBase))
}
