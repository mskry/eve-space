import { useAuthSessionInitialization } from '../composables/useAuthSessionInitialization'
import { createApiClient } from '../utils/api-client'
import { getLocalAuthRedirect } from '../utils/auth-redirect'
import { resolveRouteAudience } from '../utils/route-audience'

export default defineNuxtRouteMiddleware(async (to) => {
  const isAuthorizationRoute = to.path === '/auth'
  const audience = resolveRouteAudience(to.path, to.meta.platformAudience)
  if (audience === 'admin' || audience === 'public') return
  // The API session cookie is host-only; protected data stays client-gated while auth resolves.
  if (import.meta.server) return
  const runtimeConfig = useRuntimeConfig()
  const apiClient = createApiClient(runtimeConfig.public.apiBase)
  const initialization = useAuthSessionInitialization(apiClient)

  async function verifySession(force = true) {
    const session = await initialization.initialize(force)
    if (!session) return
    if (session.authenticated) {
      if (isAuthorizationRoute)
        return navigateTo(getLocalAuthRedirect(to.query.redirect) ?? '/characters', {
          replace: true,
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
      void verifySession(false)
    })
    return
  }
  return verifySession()
})
