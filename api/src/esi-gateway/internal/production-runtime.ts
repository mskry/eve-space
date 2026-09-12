import { randomInt } from 'node:crypto'
import type { EsiResponseMetadata } from '@evespace/esi-client'
import {
  getCharacterAuthorizationForLifecycle,
  getCharacterCacheAuthorizationForLifecycle,
  withCharacterAuthorizationForLifecycle,
} from '../../auth/tokens.js'
import { env } from '../../env.js'
import { getSharedCacheRedisConnection } from '../../cache-redis.js'
import {
  acquireEsiRequestLease,
  commitEsiFence,
  getCommittedEsiFence,
  getEsiRequestLeaseTtl,
  getEsiResourceRevision,
  incrementEsiResourceRevision,
  initializeCacheNamespace,
  releaseEsiRequestLease,
  renewEsiRequestLease,
} from './coordination.js'
import { getCoordinationConnection } from './coordination-connection.js'
import { getEsiRequestCooldowns, recordEsiResponse } from './cooldowns.js'
import { createEsiExecutionRuntime, type EsiExecutionRuntime } from './execution-runtime.js'
import { acquireEsiRequestPermit } from './permits.js'
import { recordEsiRateMeasurement } from './rate-measurement.js'
import type { EsiExecutionRuntimeConfig } from './runtime-config.js'
import type { EsiExecutionRuntimePorts, RuntimeTimingPort } from './runtime-ports.js'
import { recordEsiUpstreamOutcome } from './telemetry-counters.js'
import { wait } from './timing.js'
import { createRawEsiTransport } from './transport.js'

export interface EsiExecutionRuntimeOwner {
  get(): Promise<EsiExecutionRuntime>
  close(): Promise<void>
}

export function createEsiExecutionRuntimeOwner(
  createRuntime: () => EsiExecutionRuntime | Promise<EsiExecutionRuntime>,
): EsiExecutionRuntimeOwner {
  let runtime: EsiExecutionRuntime | undefined
  let pendingCreation: Promise<EsiExecutionRuntime> | undefined
  let pendingClose: Promise<void> | undefined

  return {
    get() {
      if (pendingClose) return Promise.reject(new Error('ESI execution runtime is closing'))
      if (runtime) return Promise.resolve(runtime)
      pendingCreation ??= Promise.resolve()
        .then(createRuntime)
        .then((created) => {
          runtime = created
          return created
        })
        .finally(() => {
          pendingCreation = undefined
        })
      return pendingCreation
    },
    close() {
      if (pendingClose) return pendingClose
      if (!runtime && !pendingCreation) return Promise.resolve()
      pendingClose = (async () => {
        let closingRuntime: EsiExecutionRuntime | undefined
        try {
          closingRuntime = runtime ?? (await pendingCreation)
        } catch {
          return
        }
        if (!closingRuntime) return
        if (runtime === closingRuntime) runtime = undefined
        await closingRuntime.close()
      })().finally(() => {
        pendingClose = undefined
      })
      return pendingClose
    },
  }
}

const productionRuntimeConfig: EsiExecutionRuntimeConfig = {
  cacheL1Capacity: env.ESI_CACHE_L1_MAX_ENTRIES,
  cacheMaximumRetentionMs: env.ESI_CACHE_MAX_RETENTION_SECONDS * 1_000,
  compatibilityDate: env.ESI_COMPATIBILITY_DATE,
  operationConcurrency: env.ESI_OPERATION_CONCURRENCY,
  operationQueueTimeoutMs: env.ESI_OPERATION_QUEUE_TIMEOUT_MS,
  privateRetentionMs: env.ESI_PRIVATE_RETENTION_SECONDS * 1_000,
  requestTimeoutMs: env.ESI_REQUEST_TIMEOUT_MS,
}

const productionRuntimeOwner = createEsiExecutionRuntimeOwner(() =>
  createEsiExecutionRuntime(
    createProductionRuntimePorts(productionRuntimeConfig),
    productionRuntimeConfig,
  ),
)

export function getProductionEsiExecutionRuntime() {
  return productionRuntimeOwner.get()
}

export function closeOwnedProductionEsiExecutionRuntime() {
  return productionRuntimeOwner.close()
}

function createProductionRuntimePorts(config: EsiExecutionRuntimeConfig): EsiExecutionRuntimePorts {
  const cache = getSharedCacheRedisConnection()
  const coordination = getCoordinationConnection()
  const timing: RuntimeTimingPort = {
    now: () => Date.now(),
    wait,
    randomInteger: randomInt,
    repeat(operation, intervalMilliseconds) {
      const timer = setInterval(operation, intervalMilliseconds)
      timer.unref()
      return () => clearInterval(timer)
    },
  }
  return {
    authorization: {
      getCacheAuthorization: (...arguments_) =>
        getCharacterCacheAuthorizationForLifecycle(...arguments_),
      getAuthorization: (...arguments_) => getCharacterAuthorizationForLifecycle(...arguments_),
      withAuthorization: (...arguments_) => withCharacterAuthorizationForLifecycle(...arguments_),
    },
    cache: {
      get: (key) => cache.get(key),
      set: async (key, value, ttlMs) => {
        if (ttlMs === undefined) await cache.set(key, value)
        else await cache.set(key, value, 'PX', ttlMs)
      },
      delete: async (key) => {
        await cache.del(key)
      },
      async recordResponse(operation, principal, metadata) {
        await Promise.all([
          recordEsiRateMeasurement(cache, {
            operation,
            principal,
            status: metadata.status,
            now: timing.now(),
          }),
          recordEsiUpstreamOutcome(
            cache,
            operation,
            metadata.status,
            metadata.routeRateLimit?.group,
          ),
        ])
      },
    },
    coordination: {
      initializeCacheNamespace: () => initializeCacheNamespace(coordination),
      acquireRequestLease: (identity) => acquireEsiRequestLease(coordination, identity),
      getRequestLeaseTtl: (identity) => getEsiRequestLeaseTtl(coordination, identity),
      renewRequestLease: (lease) => renewEsiRequestLease(coordination, lease),
      releaseRequestLease: (lease) => releaseEsiRequestLease(coordination, lease),
      commitFence: (identity, lease) => commitEsiFence(coordination, identity, lease),
      getCommittedFence: (identity) => getCommittedEsiFence(coordination, identity),
      getResourceRevision: (namespace, principal) =>
        getEsiResourceRevision(coordination, namespace, principal),
      incrementResourceRevision: (namespace, principal) =>
        incrementEsiResourceRevision(coordination, namespace, principal),
      acquireRequestPermit: (options) =>
        acquireEsiRequestPermit({
          connection: coordination,
          ...options,
          queueTimeoutMs: config.operationQueueTimeoutMs,
          timing,
        }),
      getRequestCooldowns: ({ requests, localState }) =>
        getEsiRequestCooldowns({
          connection: coordination,
          requests,
          maximumRequests: env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE,
          localState,
        }),
      recordResponse: (
        operation: Parameters<EsiExecutionRuntimePorts['coordination']['recordResponse']>[0],
        principal: string | undefined,
        metadata: EsiResponseMetadata,
        localState,
      ) =>
        recordEsiResponse({
          connection: coordination,
          operation,
          principal,
          metadata,
          localState,
          now: timing.now(),
        }),
    },
    transport: {
      create: (options) =>
        createRawEsiTransport(
          { userAgent: env.ESI_USER_AGENT, compatibilityDate: config.compatibilityDate },
          options,
        ),
    },
    timing,
  }
}
