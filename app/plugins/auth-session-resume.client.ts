import { getLocalAuthRedirect } from '../utils/auth-redirect'
import { resolveRouteAudience } from '../utils/route-audience'

export default defineNuxtPlugin({
  name: 'auth-session-resume',
  dependsOn: ['query-persistence-ready'],
  setup() {
    const route = useRoute()
    const router = useRouter()
    const runtimeConfig = useRuntimeConfig()
    const apiClient = createApiClient(runtimeConfig.public.apiBase)
    const { authSession, authVerificationInFlight, authVerificationStatus, initializeAuth } =
      useAuthSession(apiClient, { autoLoad: false })
    let refreshing = false

    async function refreshSession() {
      if (
        refreshing ||
        authVerificationInFlight.value ||
        route.path === '/auth' ||
        resolveRouteAudience(route.path, route.meta.platformAudience) !== 'authenticated'
      ) {
        return
      }

      refreshing = true
      try {
        await initializeAuth()
        if (
          route.path === '/auth' ||
          resolveRouteAudience(route.path, route.meta.platformAudience) !== 'authenticated'
        ) {
          return
        }
        if (authVerificationStatus.value === 'verified' && !authSession.value.authenticated) {
          const redirect = getLocalAuthRedirect(route.fullPath)
          await router.replace(redirect ? { path: '/auth', query: { redirect } } : '/auth')
        }
      } finally {
        refreshing = false
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSession()
    }

    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('pageshow', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
  },
})
