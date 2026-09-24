import { operationRegistry } from '@evespace/esi-client/operations'
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
  createCharacterEsiMutation,
  createCharacterEsiRead,
  createPublicEsiRead,
} from '../../src/esi-gateway/feature-execution.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import { installedModuleEsiOperationDefinitions } from '../../src/generated/platform/installed-module-esi.js'
import { getEsiCacheEnvelopeCounterSnapshot } from '../../src/esi-gateway/internal/telemetry-counters.js'
import type {
  EsiExecutionRuntimePorts,
  EsiRequestLease,
  RuntimeLocalQuotaStatePort,
} from '../../src/esi-gateway/internal/runtime-ports.js'
import { createRuntimeTestExecution, createRuntimeTestPorts } from './runtime-test-adapters.js'

const runtimeMocks = vi.hoisted(() => ({
  getProductionRuntime: vi.fn(),
}))

vi.mock('../../src/esi-gateway/internal/production-runtime.js', () => ({
  getProductionEsiExecutionRuntime: runtimeMocks.getProductionRuntime,
}))

const characterId = 7
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const ownerLease: EsiRequestLease = {
  fence: 4,
  key: 'owner-lease',
  ownerToken: 'owner',
  ttlMs: 30_000,
}

const statusRead = createPublicEsiRead({
  cacheSchema: z.number(),
  descriptor: operationRegistry.GetStatus.transport,
  encodeRequest: (_input: Record<string, never>) => ({}),
  map: ({ data }) => data.players,
  name: 'runtime-behavior-status',
  operation: 'status',
})

const walletRead = createCharacterEsiRead({
  cacheSchema: operationRegistry.GetCharactersCharacterIdWallet.responseSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: ({ data }) => data,
  name: 'runtime-behavior-wallet',
  operation: 'wallet-balance',
})

const mailLabelsRead = createCharacterEsiRead({
  cacheSchema: z.number(),
  descriptor: operationRegistry.GetCharactersCharacterIdMailLabels.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: ({ data }) => data.total_unread_count ?? 0,
  name: 'runtime-behavior-mail-labels',
  operation: 'mail-labels',
})

const mutableStatusRead = createPublicEsiRead({
  cacheSchema: z.object({ players: z.number() }),
  descriptor: operationRegistry.GetStatus.transport,
  encodeRequest: (_input: Record<string, never>) => ({}),
  map: ({ data }) => ({ players: data.players }),
  name: 'runtime-behavior-mutable-status',
  operation: 'status',
})

const deleteMail = createCharacterEsiMutation({
  descriptor: operationRegistry.DeleteCharactersCharacterIdMailMailId.transport,
  encodeRequest: (input: {
    characterId: number
    mailId: number
    subjectLifecycleId: string
    signal?: AbortSignal
  }) => ({
    path: { character_id: input.characterId, mail_id: input.mailId },
  }),
  map: (_response, input) => input.mailId,
  name: 'runtime-behavior-delete-mail',
  operation: 'mail-delete',
})

describe('ESI execution runtime behavior', () => {
  test('shares local quota state between execution and planner probes', async () => {
    let cooldownState: RuntimeLocalQuotaStatePort | undefined
    let permitState: RuntimeLocalQuotaStatePort | undefined
    const acquireRequestPermit = vi.fn(async ({ localState }) => {
      permitState = localState
      throw new EsiQuotaError(30)
    })
    const ports = createRuntimeTestPorts({
      fetch: vi.fn(),
      overrides: {
        coordination: {
          acquireRequestPermit,
          getRequestCooldowns: vi.fn(async ({ requests, localState }) => {
            cooldownState = localState
            return requests.map(() => ({
              active: true,
              retryAfterSeconds: 30,
              coordinationAvailable: false,
            }))
          }),
        },
      },
      response: statusResponse(10),
    })
    const runtime = createRuntimeTestExecution(ports, { operationConcurrency: 2 })

    await expect(runtime.getQuotaStatuses([{ operation: 'status' }])).resolves.toStrictEqual([
      { active: true, coordinationAvailable: false, retryAfterSeconds: 30 },
    ])
    await expect(runtime.isOperationQuotaLimited('status')).resolves.toBe(true)
    expect(cooldownState).toBeDefined()
    expect(permitState).toBe(cooldownState)
    expect(acquireRequestPermit).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 2 }))
  })

  test('initializes the namespace and publishes an owner result to L2', async () => {
    const cache = new Map<string, string>()
    let committedFence: number | undefined
    const fetch = vi.fn()
    const set = vi.fn(async (key: string, value: string, _ttlMs?: number) => {
      cache.set(key, value)
    })
    const coordination = coordinatedOverrides({
      acquireRequestLease: vi.fn(async () => ownerLease),
      commitFence: vi.fn(async (_identity, lease) => {
        committedFence = lease.fence
        return true
      }),
      getCommittedFence: vi.fn(async () => committedFence),
    })
    const ports = createRuntimeTestPorts({
      fetch,
      overrides: {
        cache: {
          get: async (key) => cache.get(key) ?? null,
          set,
        },
        coordination,
      },
      response: statusResponse(10),
    })
    const runtime = createRuntimeTestExecution(ports)
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await expect(statusRead.execute({})).resolves.toMatchObject({
      data: 10,
      source: 'esi',
    })

    expect(ports.coordination.initializeCacheNamespace).toHaveBeenCalledOnce()
    expect(ports.coordination.commitFence).toHaveBeenCalledWith(expect.any(Object), ownerLease)
    expect(set).toHaveBeenCalledOnce()
    const [key, serialized, ttlMs] = set.mock.calls[0] ?? []
    expect(key).toContain(':runtime-test:status:')
    expect(JSON.parse(serialized as string)).toMatchObject({
      data: 10,
      fence: ownerLease.fence,
      representationVersion: 'runtime-behavior-status@v1',
    })
    expect(ttlMs).toBeGreaterThan(0)
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('serves a fresh local cache hit without acquiring another request permit', async () => {
    const acquireRequestPermit = vi.fn(async () => requestPermit())
    const fetch = vi.fn()
    const runtime = createRuntimeTestExecution(
      createRuntimeTestPorts({
        fetch,
        overrides: { coordination: { acquireRequestPermit } },
        response: statusResponse(10),
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await statusRead.execute({})
    await expect(statusRead.execute({})).resolves.toMatchObject({ source: 'cache' })

    expect(fetch).toHaveBeenCalledOnce()
    expect(acquireRequestPermit).toHaveBeenCalledOnce()
  })

  test('rejects a malformed L1 payload before it becomes a cache hit', async () => {
    const fetch = vi.fn()
    const runtime = createRuntimeTestExecution(
      createRuntimeTestPorts({ fetch, response: statusResponse(10) }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)
    const first = await mutableStatusRead.execute({})
    ;(first.data as { players: unknown }).players = 'private-cache-value'

    await expect(mutableStatusRead.execute({})).resolves.toMatchObject({
      data: { players: 10 },
      source: 'esi',
    })

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('rejects a malformed public canonical L2 payload without promoting it', async () => {
    const rejectionCount = getEsiCacheEnvelopeCounterSnapshot().rejections.invalidPayload
    let serialized = serializedEnvelope({
      data: { players: 'private-cache-value' },
      representationVersion: 'runtime-behavior-status@v1',
    })
    const fetch = vi.fn()
    const ports = createRuntimeTestPorts({
      fetch,
      overrides: {
        cache: {
          get: async () => serialized,
          set: async (_key, value) => {
            serialized = value
          },
        },
        coordination: coordinatedOverrides({
          acquireRequestLease: vi.fn(async () => ownerLease),
          commitFence: vi.fn(async () => true),
          getCommittedFence: vi.fn(async () => ownerLease.fence),
        }),
      },
      response: statusResponse(20),
    })
    const runtime = createRuntimeTestExecution(ports)
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await expect(statusRead.execute({})).resolves.toMatchObject({ data: 20, source: 'esi' })
    await expect(statusRead.execute({})).resolves.toMatchObject({ data: 20, source: 'cache' })

    expect(fetch).toHaveBeenCalledOnce()
    expect(getEsiCacheEnvelopeCounterSnapshot().rejections.invalidPayload).toBe(rejectionCount + 1)
  })

  test('rejects a malformed private canonical L2 payload with current authorization state', async () => {
    let serialized = serializedEnvelope({
      authorization: {
        generation: 1,
        kind: 'character',
        principal: `character-${characterId}-lifecycle-${subjectLifecycleId}`,
      },
      data: 'private-cache-value',
      representationVersion: 'runtime-behavior-mail-labels@v1',
      resourceRevision: { namespace: 'mailbox', value: 0 },
    })
    const fetch = vi.fn()
    const ports = createRuntimeTestPorts({
      fetch,
      overrides: {
        cache: {
          get: async () => serialized,
          set: async (_key, value) => {
            serialized = value
          },
        },
        coordination: coordinatedOverrides({
          acquireRequestLease: vi.fn(async () => ownerLease),
          commitFence: vi.fn(async () => true),
          getCommittedFence: vi.fn(async () => ownerLease.fence),
          getResourceRevision: vi.fn(async () => 0),
        }),
      },
      response: { labels: [], total_unread_count: 6 },
    })
    const runtime = createRuntimeTestExecution(ports)
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await expect(
      mailLabelsRead.execute({ characterId, subjectLifecycleId }),
    ).resolves.toMatchObject({
      data: 6,
      source: 'esi',
    })

    expect(fetch).toHaveBeenCalledOnce()
  })

  test('rejects a malformed platform SDK-wire L2 payload', async () => {
    const operation = 'organization-activity-campaign-list'
    let serialized = serializedEnvelope({
      data: { campaigns: 'private-cache-value' },
      representationVersion: 'v1',
    })
    const fetch = vi.fn()
    const ports = createRuntimeTestPorts({
      fetch,
      overrides: {
        cache: {
          get: async () => serialized,
          set: async (_key, value) => {
            serialized = value
          },
        },
        coordination: coordinatedOverrides({
          acquireRequestLease: vi.fn(async () => ownerLease),
          commitFence: vi.fn(async () => true),
          getCommittedFence: vi.fn(async () => ownerLease.fence),
        }),
      },
      response: { campaigns: [] },
    })
    const runtime = createRuntimeTestExecution(ports)

    await expect(
      runtime.executePlatformOperation(
        { authorization: { kind: 'public' }, operation },
        installedModuleEsiOperationDefinitions[operation],
        {},
      ),
    ).resolves.toMatchObject({ result: { data: { campaigns: [] }, source: 'esi' } })

    expect(fetch).toHaveBeenCalledOnce()
  })

  test('acquires and releases one request permit for every retry attempt', async () => {
    const releases = [vi.fn(), vi.fn(), vi.fn()]
    const acquireRequestPermit = vi
      .fn()
      .mockResolvedValueOnce(requestPermit(releases[0]))
      .mockResolvedValueOnce(requestPermit(releases[1]))
      .mockResolvedValueOnce(requestPermit(releases[2]))
    const fetch = vi
      .fn()
      .mockReturnValueOnce(jsonResponse({ error: 'first failure' }, {}, 500))
      .mockReturnValueOnce(jsonResponse({ error: 'second failure' }, {}, 500))
      .mockReturnValueOnce(jsonResponse(statusResponse(20)))
    const runtime = createRuntimeTestExecution(
      createRuntimeTestPorts({
        fetch,
        overrides: { coordination: { acquireRequestPermit } },
        response: statusResponse(0),
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await expect(statusRead.execute({})).resolves.toMatchObject({ data: 20, source: 'esi' })

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(acquireRequestPermit).toHaveBeenCalledTimes(3)
    for (const release of releases) {
      expect(release).toHaveBeenCalledOnce()
    }
  })

  test('runs platform dispatch through one request permit per upstream attempt', async () => {
    const operation = 'organization-activity-campaign-list'
    const release = vi.fn()
    const acquireRequestPermit = vi.fn(async () => requestPermit(release))
    const fetch = vi.fn()
    const runtime = createRuntimeTestExecution(
      createRuntimeTestPorts({
        fetch,
        overrides: { coordination: { acquireRequestPermit } },
        response: { campaigns: [] },
      }),
    )

    await expect(
      runtime.executePlatformOperation(
        { authorization: { kind: 'public' }, operation },
        installedModuleEsiOperationDefinitions[operation],
        {},
      ),
    ).resolves.toMatchObject({ authorizationGeneration: 0, result: { source: 'esi' } })

    expect(fetch).toHaveBeenCalledOnce()
    expect(acquireRequestPermit).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  test('uses an owner publication while following an active lease', async () => {
    const cache = new Map<string, string>()
    let held = false
    let committedFence: number | undefined
    let finishOwner!: () => void
    const ownerResponse = new Promise<void>((resolve) => {
      finishOwner = resolve
    })
    const ownerFetch = vi.fn(async () => {
      await ownerResponse
    })
    const followerFetch = vi.fn()
    const sharedOverrides = {
      cache: {
        get: async (key: string) => cache.get(key) ?? null,
        set: async (key: string, value: string) => {
          cache.set(key, value)
        },
      },
      coordination: coordinatedOverrides({
        acquireRequestLease: vi.fn(async () => {
          if (held) {
            return undefined
          }
          held = true
          return ownerLease
        }),
        commitFence: vi.fn(async (_identity, lease) => {
          committedFence = lease.fence
          return true
        }),
        getCommittedFence: vi.fn(async () => committedFence),
        getRequestLeaseTtl: vi.fn(async () => (held ? ownerLease.ttlMs : 0)),
        releaseRequestLease: vi.fn(async () => {
          held = false
          return true
        }),
      }),
    } satisfies NonNullable<Parameters<typeof createRuntimeTestPorts>[0]['overrides']>
    const owner = createRuntimeTestExecution(
      createRuntimeTestPorts({
        fetch: ownerFetch,
        overrides: sharedOverrides,
        response: statusResponse(20),
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(owner)
    const ownerExecution = statusRead.execute({})
    await vi.waitFor(() => expect(ownerFetch).toHaveBeenCalledOnce())
    const followerPorts = createRuntimeTestPorts({
      fetch: followerFetch,
      overrides: {
        ...sharedOverrides,
        timing: {
          wait: async () => {
            finishOwner()
            await ownerExecution
          },
        },
      },
      response: statusResponse(30),
    })
    const follower = createRuntimeTestExecution(followerPorts)
    runtimeMocks.getProductionRuntime.mockResolvedValue(follower)

    await expect(statusRead.execute({})).resolves.toMatchObject({
      data: 20,
      source: 'cache',
    })

    await ownerExecution
    expect(followerFetch).not.toHaveBeenCalled()
    expect(followerPorts.coordination.getRequestLeaseTtl).toHaveBeenCalledOnce()
  })

  test('conditionally revalidates a stale envelope through EsiNotModifiedError', async () => {
    let now = Date.now()
    let fence = 0
    const requests: Request[] = []
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (requests.length === 1) {
        return jsonResponse(statusResponse(40), {
          ETag: '"status-v1"',
          Expires: new Date(now + 1000).toUTCString(),
        })
      }
      return new Response(null, {
        headers: {
          ETag: '"status-v2"',
          Expires: new Date(now + 5000).toUTCString(),
        },
        status: 304,
      })
    })
    const ports = createRuntimeTestPorts({
      fetch,
      overrides: {
        coordination: coordinatedOverrides({
          acquireRequestLease: vi.fn(async () => ({ ...ownerLease, fence: ++fence })),
          commitFence: vi.fn(async () => true),
        }),
        timing: { now: () => now },
      },
      response: statusResponse(0),
    })
    const runtime = createRuntimeTestExecution(ports)
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)
    await statusRead.execute({})
    now += 2000

    await expect(statusRead.execute({})).resolves.toMatchObject({
      data: 40,
      source: 'not-modified',
      stale: false,
    })

    expect(requests[1]?.headers.get('If-None-Match')).toBe('"status-v1"')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('retries a character read when its authorization generation changes before return', async () => {
    const getCacheAuthorization = vi
      .fn()
      .mockResolvedValueOnce({ tokenVersion: 1 })
      .mockResolvedValueOnce({ tokenVersion: 2 })
      .mockResolvedValueOnce({ tokenVersion: 2 })
    const getAuthorization = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: 'first-token', tokenVersion: 1 })
      .mockResolvedValueOnce({ accessToken: 'second-token', tokenVersion: 2 })
    let response = 100
    const fetch = vi.fn(() => jsonResponse(response++))
    const runtime = createRuntimeTestExecution(
      createRuntimeTestPorts({
        fetch,
        overrides: { authorization: { getAuthorization, getCacheAuthorization } },
        response: 0,
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await expect(walletRead.execute({ characterId, subjectLifecycleId })).resolves.toMatchObject({
      data: 101,
      source: 'esi',
    })

    expect(getCacheAuthorization).toHaveBeenCalledTimes(3)
    expect(getAuthorization).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('marks a failed mutation revision and repairs it before the next read', async () => {
    const cache = new Map<string, string>()
    const cacheSet = vi.fn(async (key: string, value: string) => {
      cache.set(key, value)
    })
    const cacheDelete = vi.fn(async (key: string) => {
      cache.delete(key)
    })
    let repairRevision = false
    const incrementResourceRevision = vi.fn(async () => {
      if (!repairRevision) {
        throw new Error('coordination unavailable')
      }
      return 9
    })
    const fetch = vi
      .fn()
      .mockReturnValueOnce(new Response(null, { status: 204 }))
      .mockReturnValueOnce(jsonResponse({ labels: [], total_unread_count: 3 }))
    const mutationRelease = vi.fn()
    const acquireRequestPermit = vi.fn(async () => requestPermit(mutationRelease))
    const ports = createRuntimeTestPorts({
      fetch,
      overrides: {
        cache: {
          delete: cacheDelete,
          get: async (key) => cache.get(key) ?? null,
          set: cacheSet,
        },
        coordination: coordinatedOverrides({
          acquireRequestLease: vi.fn(async () => ownerLease),
          commitFence: vi.fn(async () => true),
          incrementResourceRevision,
          acquireRequestPermit,
        }),
      },
      response: undefined,
    })
    const runtime = createRuntimeTestExecution(ports)
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await expect(
      deleteMail.execute({ characterId, mailId: 50, subjectLifecycleId }),
    ).rejects.toThrow('ESI resource revision is temporarily unavailable')
    expect(incrementResourceRevision).toHaveBeenCalledTimes(3)
    expect(acquireRequestPermit).toHaveBeenCalledOnce()
    expect(mutationRelease).toHaveBeenCalledOnce()
    expect(cacheSet).toHaveBeenCalledWith(expect.stringContaining(':revision-repair:mailbox:'), '1')

    repairRevision = true
    await expect(
      mailLabelsRead.execute({ characterId, subjectLifecycleId }),
    ).resolves.toMatchObject({ data: 3, source: 'esi' })

    expect(incrementResourceRevision).toHaveBeenCalledTimes(4)
    expect(cacheDelete).toHaveBeenCalledWith(expect.stringContaining(':revision-repair:mailbox:'))
    const published = cacheSet.mock.calls.map(([, value]) => value).find((value) => value !== '1')
    expect(JSON.parse(published as string)).toMatchObject({
      resourceRevision: { namespace: 'mailbox', value: 9 },
    })
  })

  test('preserves the existing retry count for an ambiguous mutation transport failure', async () => {
    const failure = new TypeError('network unavailable')
    const fetch = vi.fn().mockRejectedValue(failure)
    const release = vi.fn()
    const acquireRequestPermit = vi.fn(async () => requestPermit(release))
    const incrementResourceRevision = vi.fn(async () => 2)
    const runtime = createRuntimeTestExecution(
      createRuntimeTestPorts({
        fetch,
        overrides: {
          coordination: { acquireRequestPermit, incrementResourceRevision },
        },
        response: undefined,
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await expect(
      deleteMail.execute({ characterId, mailId: 50, subjectLifecycleId }),
    ).rejects.toMatchObject({ cause: failure, code: 'ESI_TRANSPORT_ERROR' })

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(acquireRequestPermit).toHaveBeenCalledTimes(3)
    expect(release).toHaveBeenCalledTimes(3)
    expect(incrementResourceRevision).toHaveBeenCalledOnce()
  })

  test('lets a dispatched mutation finish despite later caller cancellation', async () => {
    const cancellation = new Error('caller cancelled')
    const controller = new AbortController()
    let transportSignal: AbortSignal | undefined
    let finishFetch!: (response: Response) => void
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          transportSignal = init?.signal ?? undefined
          finishFetch = resolve
        }),
    )
    const release = vi.fn()
    const acquireRequestPermit = vi.fn(async () => requestPermit(release))
    const incrementResourceRevision = vi.fn(async () => 2)
    const runtime = createRuntimeTestExecution(
      createRuntimeTestPorts({
        fetch,
        overrides: {
          coordination: { acquireRequestPermit, incrementResourceRevision },
        },
        response: undefined,
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)
    const caught = deleteMail
      .execute({ characterId, mailId: 50, signal: controller.signal, subjectLifecycleId })
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(transportSignal).toBeDefined())

    controller.abort(cancellation)
    expect(transportSignal?.aborted).toBe(false)
    finishFetch(new Response(null, { status: 204 }))

    await expect(caught).resolves.toBe(50)
    expect(fetch).toHaveBeenCalledOnce()
    expect(acquireRequestPermit).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    expect(incrementResourceRevision).toHaveBeenCalledOnce()
  })
})

function coordinatedOverrides(
  overrides: Partial<EsiExecutionRuntimePorts['coordination']> = {},
): Partial<EsiExecutionRuntimePorts['coordination']> {
  return {
    initializeCacheNamespace: vi.fn(async () => 'runtime-test'),
    ...overrides,
  }
}

function jsonResponse(data: unknown, headers: HeadersInit = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...headers },
    status,
  })
}

function requestPermit(release = vi.fn()) {
  return {
    coordinationAvailable: false,
    release,
    renew: vi.fn(async () => true),
    ttlMs: 30_000,
  }
}

function statusResponse(players: number) {
  return {
    players,
    server_version: 'test',
    start_time: '2026-09-11T00:00:00Z',
    vip: false,
  }
}

function serializedEnvelope(options: {
  data: unknown
  representationVersion: string
  authorization?: {
    kind: 'character'
    principal: string
    generation: number
  }
  resourceRevision?: { namespace: string; value: number }
}) {
  const freshUntil = Date.now() + 60_000
  return JSON.stringify({
    authorization: options.authorization,
    data: options.data,
    fence: ownerLease.fence,
    freshUntil,
    representationVersion: options.representationVersion,
    resourceRevision: options.resourceRevision,
    retainUntil: freshUntil,
    staleUntil: freshUntil,
    validatedAt: new Date().toISOString(),
    version: 3,
  })
}
