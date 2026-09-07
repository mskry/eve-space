declare module '#imports' {
  export { computed } from 'vue'
  export {
    useRuntimeConfig,
    useAnnouncer,
    abortNavigation,
    createError,
    defineNuxtRouteMiddleware,
  } from 'nuxt/app'
}

declare module '#build/eve-space-platform/navigation' {
  export const platformNavigation: readonly import('../src/runtime/navigation.js').PlatformNavigationEntry[]
  export const platformPageMetadata: readonly import('../src/runtime/navigation.js').PlatformPageMetadata[]
}
