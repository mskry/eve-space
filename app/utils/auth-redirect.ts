const localOrigin = 'http://nuxt.local'

export function getLocalAuthRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/')) return

  const destination = parseLocalDestination(value)
  if (!destination || isAuthorizationPath(destination.pathname)) return

  return `${destination.pathname}${destination.search}${destination.hash}`
}

export function getAuthLoginUrl(loginUrl: string, redirect: unknown) {
  const returnPath = getLocalAuthRedirect(redirect)
  if (!loginUrl || !returnPath) return loginUrl

  const destination = new URL(loginUrl)
  destination.searchParams.set('returnTo', returnPath)
  return destination.toString()
}

function parseLocalDestination(value: string) {
  try {
    const destination = new URL(value, localOrigin)
    return destination.origin === localOrigin ? destination : undefined
  } catch {
    return undefined
  }
}

function isAuthorizationPath(value: string) {
  let path = value
  for (let depth = 0; depth < 4; depth += 1) {
    const destination = parseLocalDestination(path)
    if (!destination || ['/auth', '/auth/'].includes(destination.pathname)) return true
    if (!/%[\dA-Fa-f]{2}/.test(destination.pathname)) return false
    try {
      path = decodeURIComponent(destination.pathname)
    } catch {
      return true
    }
  }
  return true
}
