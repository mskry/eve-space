import type { EsiResponseMetadata } from '@evespace/esi-client'
import type { EsiOperation } from './catalog.js'
import type { EsiRepresentationIdentity } from './identity.js'

export interface EsiRequestLease {
  readonly key: string
  readonly ownerToken: string
  readonly fence: number
  readonly ttlMs: number
}

export interface EsiRequestPermit {
  readonly coordinationAvailable: boolean
  readonly ttlMs: number
  renew(): Promise<boolean>
  release(): Promise<void>
}

interface EsiQuotaProbeRequest {
  readonly operation: EsiOperation
  readonly principal?: string
}

interface EsiQuotaProbeStatus {
  readonly active: boolean
  readonly retryAfterSeconds: number | null
  readonly coordinationAvailable: boolean
}

interface CharacterAuthorizationPort {
  getCacheAuthorization(
    characterId: number,
    lifecycleId: string,
    requiredScope: string,
    signal?: AbortSignal,
  ): Promise<{ readonly tokenVersion: number }>
  getAuthorization(
    characterId: number,
    lifecycleId: string,
    requiredScope: string,
    signal?: AbortSignal,
  ): Promise<{ readonly accessToken: string; readonly tokenVersion: number }>
  withAuthorization<Result>(
    characterId: number,
    lifecycleId: string,
    requiredScope: string,
    operation: (authorization: {
      readonly accessToken: string
      readonly tokenVersion: number
    }) => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result>
}

export interface CacheRedisPort {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs?: number): Promise<void>
  delete(key: string): Promise<void>
  recordResponse(
    operation: EsiOperation,
    principal: string | undefined,
    metadata: EsiResponseMetadata,
  ): Promise<void>
}

export interface CoordinationPort {
  initializeCacheNamespace(): Promise<string>
  acquireRequestLease(identity: EsiRepresentationIdentity): Promise<EsiRequestLease | undefined>
  getRequestLeaseTtl(identity: EsiRepresentationIdentity): Promise<number>
  renewRequestLease(lease: EsiRequestLease): Promise<boolean>
  releaseRequestLease(lease: EsiRequestLease): Promise<boolean>
  commitFence(identity: EsiRepresentationIdentity, lease: EsiRequestLease): Promise<boolean>
  getCommittedFence(identity: EsiRepresentationIdentity): Promise<number | undefined>
  getResourceRevision(namespace: string, principal: string): Promise<number>
  incrementResourceRevision(namespace: string, principal: string): Promise<number>
  acquireRequestPermit(options: {
    readonly operation: EsiOperation
    readonly principal?: string
    readonly concurrency: number
    readonly localState: RuntimeLocalQuotaStatePort
    readonly signal?: AbortSignal
  }): Promise<EsiRequestPermit>
  getRequestCooldowns(options: {
    readonly requests: readonly EsiQuotaProbeRequest[]
    readonly localState: RuntimeLocalQuotaStatePort
  }): Promise<readonly EsiQuotaProbeStatus[]>
  recordResponse(
    operation: EsiOperation,
    principal: string | undefined,
    metadata: EsiResponseMetadata,
    localState: RuntimeLocalQuotaStatePort,
  ): Promise<void>
}

interface ApplicationEsiTransportPort {
  create(options: { readonly onResponseBodySettled: () => void }): typeof globalThis.fetch
}

export interface RuntimeTimingPort {
  now(): number
  wait(milliseconds: number, signal?: AbortSignal): Promise<void>
  randomInteger(maximumExclusive: number): number
  repeat(operation: () => void, intervalMilliseconds: number): () => void
}

export interface RuntimeLocalQuotaStatePort {
  readonly operationCooldowns: Map<string, number>
  readonly groupCooldowns: Map<string, number>
  readonly inFlight: Map<string, number>
  globalCooldownUntil: number
}

export interface BoundedStringSetPort {
  has(value: string): boolean
  add(value: string): void
  delete(value: string): void
  clear(): void
}

export interface EsiExecutionRuntimePorts {
  readonly authorization: CharacterAuthorizationPort
  readonly cache: CacheRedisPort
  readonly coordination: CoordinationPort
  readonly transport: ApplicationEsiTransportPort
  readonly timing: RuntimeTimingPort
}
