export default defineNuxtRouteMiddleware(async (to) => {
  const isAuthorizationRoute = to.path === '/auth'
  const runtimeConfig = useRuntimeConfig()
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  try {
    const session = await $fetch<{ authenticated: boolean }>(
      `${runtimeConfig.public.apiBase}/auth/session`,
      {
        credentials: 'include',
        headers: requestHeaders,
      },
    )
    if (session.authenticated) {
      if (isAuthorizationRoute) return navigateTo('/')
      return
    }
  } catch {
    // Treat a failed session check as unauthenticated rather than rendering protected content.
  }

  if (isAuthorizationRoute) return
  return navigateTo({ path: '/auth', query: { redirect: to.fullPath } })
})
