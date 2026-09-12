import { createEsiExecutionRuntime } from '../../src/esi-gateway/internal/execution-runtime.js'
import type { EsiExecutionRuntimePorts } from '../../src/esi-gateway/internal/runtime-ports.js'
import type { EsiExecutionRuntimeConfig } from '../../src/esi-gateway/internal/runtime-config.js'

type RuntimeTestPortOverrides = {
  readonly [Port in keyof EsiExecutionRuntimePorts]?: Partial<EsiExecutionRuntimePorts[Port]>
}

export const runtimeTestConfig: EsiExecutionRuntimeConfig = {
  cacheL1Capacity: 250,
  cacheMaximumRetentionMs: 86_400_000,
  compatibilityDate: '2026-08-23',
  operationConcurrency: 6,
  operationQueueTimeoutMs: 30_000,
  privateRetentionMs: 86_400_000,
  requestTimeoutMs: 30_000,
}

export function createRuntimeTestExecution(
  ports: EsiExecutionRuntimePorts,
  config: Partial<EsiExecutionRuntimeConfig> = {},
) {
  return createEsiExecutionRuntime(ports, { ...runtimeTestConfig, ...config })
}

export function createRuntimeTestPorts(options: {
  readonly response: unknown
  readonly fetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => void | Response | Promise<void | Response>
  readonly headers?: HeadersInit
  readonly status?: number
  readonly overrides?: RuntimeTestPortOverrides
}): EsiExecutionRuntimePorts {
  const ports: EsiExecutionRuntimePorts = {
    authorization: {
      getCacheAuthorization: async () => ({ tokenVersion: 1 }),
      getAuthorization: async () => ({ accessToken: 'test-token', tokenVersion: 1 }),
      withAuthorization: async (_characterId, _lifecycleId, _scope, operation) =>
        operation({ accessToken: 'test-token', tokenVersion: 1 }),
      ...options.overrides?.authorization,
    },
    cache: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      recordResponse: async () => {},
      ...options.overrides?.cache,
    },
    coordination: {
      initializeCacheNamespace: async () => {
        throw new Error('coordination unavailable')
      },
      acquireRequestLease: async () => undefined,
      getRequestLeaseTtl: async () => 0,
      renewRequestLease: async () => true,
      releaseRequestLease: async () => true,
      commitFence: async () => false,
      getCommittedFence: async () => undefined,
      getResourceRevision: async () => 0,
      incrementResourceRevision: async () => 1,
      acquireRequestPermit: async () => ({
        coordinationAvailable: false,
        ttlMs: 30_000,
        renew: async () => true,
        release: async () => {},
      }),
      getRequestCooldowns: async ({ requests }) =>
        requests.map(() => ({
          active: false,
          retryAfterSeconds: null,
          coordinationAvailable: true,
        })),
      recordResponse: async () => {},
      ...options.overrides?.coordination,
    },
    transport: {
      create:
        ({ onResponseBodySettled }) =>
        async (input, init) => {
          const response = await options.fetch(input, init)
          onResponseBodySettled()
          if (response instanceof Response) return response
          const status = options.status ?? 200
          return new Response(
            status === 204 || status === 304 ? null : JSON.stringify(options.response),
            {
              status,
              headers: {
                'Content-Type': 'application/json',
                Expires: new Date(Date.now() + 60_000).toUTCString(),
                ...options.headers,
              },
            },
          )
        },
      ...options.overrides?.transport,
    },
    timing: {
      now: () => Date.now(),
      wait: async () => {},
      randomInteger: () => 0,
      repeat: () => () => {},
      ...options.overrides?.timing,
    },
  }
  return ports
}
