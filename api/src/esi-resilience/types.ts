import type { EsiResponseMetadata } from '@evespace/esi-client'

export interface EsiExecutionOptions {
  readonly signal?: AbortSignal
}

export interface CharacterEsiExecutionOptions extends EsiExecutionOptions {
  readonly subjectLifecycleId: string
}

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

/** Monotonic per-principal revision that invalidates every representation derived from it. */
export interface EsiResourceRevision {
  namespace: string
  value: number
}

export interface EsiCacheEnvelope<Data> {
  version: 3
  representationVersion: string
  data: Data
  freshUntil: number
  staleUntil: number
  retainUntil: number
  validatedAt: string
  etag?: string
  lastModified?: string
  authorization?: EsiCacheAuthorization
  resourceRevision?: EsiResourceRevision
  fence: number
}

export interface EsiLoadResult<Data> {
  data: Data
  meta: EsiResponseMetadata
}

export interface EsiCachedResult<Data> {
  data: Data
  cachedUntil: string
  validatedAt: string
  source: 'esi' | 'cache' | 'not-modified'
  stale: boolean
  retryAt?: string
  refreshFailureClass?: 'esi-cooldown' | 'esi-unavailable' | 'response-invalid' | 'unknown'
  quota: EsiQuota
}

export type EsiResultMetadata = Pick<
  EsiCachedResult<unknown>,
  'cachedUntil' | 'validatedAt' | 'stale' | 'refreshFailureClass'
>
