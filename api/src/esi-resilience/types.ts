import type { EsiResponseMetadata } from '@evespace/esi-client'

export interface EsiQuota {
  group?: string
  limit?: string
  remaining?: number
  used?: number
  errorRemaining?: number
  errorResetSeconds?: number
}

export interface EsiRevalidation {
  ifNoneMatch?: string
  ifModifiedSince?: string
}

export interface EsiCacheAuthorization {
  kind: 'character'
  principal: string
  generation: number
}

export interface EsiCacheEnvelope<Data> {
  version: 2
  representationVersion: string
  data: Data
  freshUntil: number
  staleUntil: number
  retainUntil: number
  validatedAt: string
  etag?: string
  lastModified?: string
  authorization?: EsiCacheAuthorization
  fence: number
}

export interface EsiLoadResult<Data> {
  data: Data
  meta: EsiResponseMetadata
}

export interface EsiCachedResult<Data> {
  data: Data
  cachedUntil: string
  checkedAt: string
  source: 'esi' | 'cache' | 'not-modified'
  stale: boolean
  retryAt?: string
  quota: EsiQuota
}
