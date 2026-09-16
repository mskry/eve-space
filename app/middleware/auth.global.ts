import { useAuthVerification } from '../composables/useAuthVerification'
import { loadCacheAdmission, type AuthSession } from '../queries/auth'
import { createApiClient } from '../utils/api-client'
import { getLocalAuthRedirect } from '../utils/auth-redirect'
import { API_BOOTSTRAP_TIMEOUT_MS, createRequestSignal } from '../utils/request-signal'
import { resolveRouteAudience } from '../utils/route-audience'

export default defineNuxtRouteMiddleware(async (to) => {
  const isAuthorizationRoute = to.path === '/auth'
  const audience = resolveRouteAudience(to.path, to.meta.platformAudience)
  if (audience === 'admin' || audience === 'public') return
  // The API session cookie is host-only; protected data stays client-gated while auth resolves.
  if (import.meta.server) return
  const runtimeConfig = useRuntimeConfig()
  const apiClient = createApiClient(runtimeConfig.public.apiBase)
  const queryCache = useQueryCache()
  const authVerification = useAuthVerification()

  async function verifySession() {
    const verificationGeneration = authVerification.beginVerification()
    try {
      const session = await $fetch<AuthSession>(`${runtimeConfig.public.apiBase}/auth/session`, {
        credentials: 'include',
        signal: createRequestSignal(API_BOOTSTRAP_TIMEOUT_MS),
      })
      const accepted = await authVerification.markVerified(
        queryCache,
        verificationGeneration,
        session,
        (signal) => loadCacheAdmission(apiClient, signal),
      )
      if (!accepted) return
      if (session.authenticated) {
        if (isAuthorizationRoute)
          return navigateTo(getLocalAuthRedirect(to.query.redirect) ?? '/characters', {
            replace: true,
          })
        return
      }
    } catch {
      // $fetch failures carry no session verdict; an unauthenticated session arrives as a 200 body.
      authVerification.markUnavailable(queryCache, verificationGeneration, {
        retainPrivateData: true,
      })
      return
    }

    if (isAuthorizationRoute) return
    const redirect = getLocalAuthRedirect(to.fullPath)
    return navigateTo(redirect ? { path: '/auth', query: { redirect } } : { path: '/auth' })
  }

  const nuxtApp = useNuxtApp()
  if (nuxtApp.isHydrating && nuxtApp.payload.serverRendered) {
    const currentRoute = useRouter().currentRoute
    onNuxtReady(() => {
      if (currentRoute.value.fullPath !== to.fullPath) return
      void verifySession()
    })
    return
  }
  return verifySession()
})
