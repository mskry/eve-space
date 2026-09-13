import type { PlatformNavigationAudience } from '@eve-space/platform-module-contract'

export function resolveRouteAudience(
  path: string,
  declaredAudience: PlatformNavigationAudience | undefined,
): PlatformNavigationAudience {
  if (path.startsWith('/admin')) return 'admin'
  return declaredAudience ?? 'authenticated'
}
