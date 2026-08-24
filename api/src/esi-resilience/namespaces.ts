export const cacheEnvelopeVersion = 'v1'
const cachePrefix = `eve-space:esi-cache:${cacheEnvelopeVersion}`

export const cacheNamespaceVersionKey = 'eve-space:esi-cache:namespace-version'
export const cacheCoordinationSentinelKey = 'eve-space:esi-cache:coordination-sentinel'

export function cacheEnvelopeKey(namespaceVersion: number, operation: string, resource: string) {
  assertCacheIdentity(operation, 'operation')
  assertCacheIdentity(resource, 'resource')
  return `${cachePrefix}:${namespaceVersion}:${operation}:${resource}`
}

/** Cache identities are public, normalized resource labels, never credentials or bearer material. */
function assertCacheIdentity(value: string, field: 'operation' | 'resource') {
  if (!value || /[\s:]/.test(value) || /token|bearer|credential|secret|session/i.test(value))
    throw new Error(`Unsafe cache ${field} identity`)
}

export function assertCacheValueSafe(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  for (const [key, nested] of Object.entries(value)) {
    if (/token|bearer|credential|secret|session/i.test(key)) throw new Error('Unsafe cache value')
    assertCacheValueSafe(nested)
  }
}
