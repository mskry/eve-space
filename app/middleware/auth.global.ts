import { getLocalAuthRedirect } from '../utils/auth-redirect'

export default defineNuxtRouteMiddleware(async (to) => {
  const isAuthorizationRoute = to.path === '/auth'
  if (to.path.startsWith('/admin') || to.meta.platformAudience === 'public') return
  // The API session cookie is host-only; protected data stays client-gated while auth resolves.
  if (import.meta.server) return
  const runtimeConfig = useRuntimeConfig()

  try {
    const session = await $fetch<{ authenticated: boolean }>(
      `${runtimeConfig.public.apiBase}/auth/session`,
      {
        credentials: 'include',
      },
    )
    if (session.authenticated) {
      if (isAuthorizationRoute)
        return navigateTo(getLocalAuthRedirect(to.query.redirect) ?? '/characters', {
          replace: true,
        })
      return
    }
  } catch {
    // Treat a failed session check as unauthenticated rather than rendering protected content.
  }

  if (isAuthorizationRoute) return
  const authRoute = { path: '/auth', query: { redirect: to.fullPath } }
  const nuxtApp = useNuxtApp()
  if (nuxtApp.isHydrating && nuxtApp.payload.serverRendered) {
    onNuxtReady(() => navigateTo(authRoute))
    return
  }
  return navigateTo(authRoute)
})
