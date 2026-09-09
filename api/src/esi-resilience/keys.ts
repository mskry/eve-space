import type { EsiRepresentationIdentity } from './identity.js'

export const cacheEnvelopeVersion = 'v3'
export const cacheIdentityVersion = 'v3'
const cachePrefix = `eve-space:esi-cache:${cacheEnvelopeVersion}:${cacheIdentityVersion}`

export const cacheCoordinationSentinelKey = 'eve-space:esi-cache:coordination-sentinel'

export function cacheEnvelopeKey(namespace: string, identity: EsiRepresentationIdentity) {
  return `${cachePrefix}:${namespace}:${identity.operation}:${identity.digest}`
}

export function cacheResourceRevisionRepairKey(namespace: string, principal: string) {
  return `${cachePrefix}:revision-repair:${namespace}:${principal}`
}
