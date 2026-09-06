import { getLocalAuthRedirect } from '../utils/auth-redirect'

export default defineNuxtRouteMiddleware(async (to) => {
  const isAuthorizationRoute = to.path === '/auth'
  if (to.meta.platformAudience === 'public') return
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
        return navigateTo(getLocalAuthRedirect(to.query.redirect) ?? '/', { replace: true })
      return
    }
  } catch {
    // Treat a failed session check as unauthenticated rather than rendering protected content.
  }

  if (isAuthorizationRoute) return
  return navigateTo({ path: '/auth', query: { redirect: to.fullPath } })
})
