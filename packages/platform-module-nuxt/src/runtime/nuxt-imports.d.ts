declare module '#imports' {
  export const computed: (typeof import('vue'))['computed']
  export function useRuntimeConfig(): { readonly public: { readonly apiBase: string } }
  export function abortNavigation(error?: Error): false
  export function createError(input: {
    readonly statusCode: number
    readonly statusMessage: string
  }): Error
  export function defineNuxtRouteMiddleware(
    middleware: (to: { readonly meta: Record<string, unknown> }) => unknown,
  ): (to: { readonly meta: Record<string, unknown> }) => unknown
}

declare module '#build/eve-space-platform/navigation' {
  export const platformNavigation: readonly unknown[]
}
