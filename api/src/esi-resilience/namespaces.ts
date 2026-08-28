import type { EsiRepresentationIdentity } from './identity.js'

export const cacheEnvelopeVersion = 'v2'
export const cacheIdentityVersion = 'v2'
const cachePrefix = `eve-space:esi-cache:${cacheEnvelopeVersion}:${cacheIdentityVersion}`

export const cacheCoordinationSentinelKey = 'eve-space:esi-cache:coordination-sentinel'

export function cacheEnvelopeKey(namespace: string, identity: EsiRepresentationIdentity) {
  return `${cachePrefix}:${namespace}:${identity.operation}:${identity.digest}`
}

export function cacheResourceRevisionRepairKey(namespace: string, principal: string) {
  return `${cachePrefix}:revision-repair:${namespace}:${principal}`
}

export function assertCacheValueSafe(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  for (const [key, nested] of Object.entries(value)) {
    if (/token|bearer|credential|secret|session/i.test(key)) throw new Error('Unsafe cache value')
    assertCacheValueSafe(nested)
  }
}
