import { getLocalAuthRedirect } from '../utils/auth-redirect'
import { resolveRouteAudience } from '../utils/route-audience'

export default defineNuxtRouteMiddleware(async (to) => {
  const isAuthorizationRoute = to.path === '/auth'
  const audience = resolveRouteAudience(to.path, to.meta.platformAudience)
  if (audience === 'admin' || audience === 'public') return
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
  const redirect = getLocalAuthRedirect(to.fullPath)
  const authRoute = redirect ? { path: '/auth', query: { redirect } } : { path: '/auth' }
  const nuxtApp = useNuxtApp()
  if (nuxtApp.isHydrating && nuxtApp.payload.serverRendered) {
    onNuxtReady(() => navigateTo(authRoute))
    return
  }
  return navigateTo(authRoute)
})
