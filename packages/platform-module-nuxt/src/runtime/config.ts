declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    apiBase: string
    eveImageBase: string
  }
}

export type { PublicRuntimeConfig } from '@nuxt/schema'
