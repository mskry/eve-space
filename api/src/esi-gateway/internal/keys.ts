import type { EsiRepresentationIdentity } from './identity.js'

export const cacheEnvelopeVersion = 'v3'
export const cacheIdentityVersion = 'v4'
const cachePrefix = `eve-space:esi-cache:${cacheEnvelopeVersion}:${cacheIdentityVersion}`

export const cacheCoordinationSentinelKey = 'eve-space:esi-cache:coordination-sentinel'

export function cacheEnvelopeKey(namespace: string, identity: EsiRepresentationIdentity) {
  return `${cachePrefix}:${namespace}:${identity.operation}:${identity.digest}`
}
