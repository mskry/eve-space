import { operationRegistry } from '@evespace/esi-client/operations'
import { describe, expect, test, vi } from 'vitest'
import {
  createCharacterEsiMutation,
  createCharacterEsiRead,
  createPublicEsiRead,
} from '../../src/esi-gateway/feature-execution.js'
import { EsiQuotaError } from '../../src/esi-gateway/failures.js'
import { installedModuleEsiOperationDefinitions } from '../../src/generated/platform/installed-module-esi.js'
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
  key: 'owner-lease',
  ownerToken: 'owner',
  fence: 4,
  ttlMs: 30_000,
}

const statusRead = createPublicEsiRead({
  operation: 'status',
  name: 'runtime-behavior-status',
  descriptor: operationRegistry.GetStatus.transport,
  encodeRequest: (_input: Record<string, never>) => ({}),
  map: ({ data }) => data.players,
})

const walletRead = createCharacterEsiRead({
  operation: 'wallet-balance',
  name: 'runtime-behavior-wallet',
  descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: ({ data }) => data,
})

const mailLabelsRead = createCharacterEsiRead({
  operation: 'mail-labels',
  name: 'runtime-behavior-mail-labels',
  descriptor: operationRegistry.GetCharactersCharacterIdMailLabels.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: ({ data }) => data.total_unread_count ?? 0,
})

const deleteMail = createCharacterEsiMutation({
  operation: 'mail-delete',
  name: 'runtime-behavior-delete-mail',
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
      response: statusResponse(10),
      fetch: vi.fn(),
      overrides: {
        coordination: {
          getRequestCooldowns: vi.fn(async ({ requests, localState }) => {
            cooldownState = localState
            return requests.map(() => ({
              active: true,
              retryAfterSeconds: 30,
              coordinationAvailable: false,
            }))
          }),
          acquireRequestPermit,
        },
      },
    })
    const runtime = createRuntimeTestExecution(ports, { operationConcurrency: 2 })

    await expect(runtime.getQuotaStatuses([{ operation: 'status' }])).resolves.toEqual([
      { active: true, retryAfterSeconds: 30, coordinationAvailable: false },
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
      response: statusResponse(10),
      fetch,
      overrides: {
        cache: {
          get: async (key) => cache.get(key) ?? null,
          set,
        },
        coordination,
      },
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
        response: statusResponse(10),
        fetch,
        overrides: { coordination: { acquireRequestPermit } },
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await statusRead.execute({})
    await expect(statusRead.execute({})).resolves.toMatchObject({ source: 'cache' })

    expect(fetch).toHaveBeenCalledOnce()
    expect(acquireRequestPermit).toHaveBeenCalledOnce()
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
        response: statusResponse(0),
        fetch,
        overrides: { coordination: { acquireRequestPermit } },
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await expect(statusRead.execute({})).resolves.toMatchObject({ data: 20, source: 'esi' })

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(acquireRequestPermit).toHaveBeenCalledTimes(3)
    for (const release of releases) expect(release).toHaveBeenCalledOnce()
  })

  test('runs platform dispatch through one request permit per upstream attempt', async () => {
    const operation = 'organization-activity-campaign-list'
    const release = vi.fn()
    const acquireRequestPermit = vi.fn(async () => requestPermit(release))
    const fetch = vi.fn()
    const runtime = createRuntimeTestExecution(
      createRuntimeTestPorts({
        response: { campaigns: [] },
        fetch,
        overrides: { coordination: { acquireRequestPermit } },
      }),
    )

    await expect(
      runtime.executePlatformOperation(
        { operation, authorization: { kind: 'public' } },
        installedModuleEsiOperationDefinitions[operation],
        {},
      ),
    ).resolves.toMatchObject({ result: { source: 'esi' }, authorizationGeneration: 0 })

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
          if (held) return undefined
          held = true
          return ownerLease
        }),
        getRequestLeaseTtl: vi.fn(async () => (held ? ownerLease.ttlMs : 0)),
        releaseRequestLease: vi.fn(async () => {
          held = false
          return true
        }),
        commitFence: vi.fn(async (_identity, lease) => {
          committedFence = lease.fence
          return true
        }),
        getCommittedFence: vi.fn(async () => committedFence),
      }),
    } satisfies NonNullable<Parameters<typeof createRuntimeTestPorts>[0]['overrides']>
    const owner = createRuntimeTestExecution(
      createRuntimeTestPorts({
        response: statusResponse(20),
        fetch: ownerFetch,
        overrides: sharedOverrides,
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(owner)
    const ownerExecution = statusRead.execute({})
    await vi.waitFor(() => expect(ownerFetch).toHaveBeenCalledOnce())
    const followerPorts = createRuntimeTestPorts({
      response: statusResponse(30),
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
      if (requests.length === 1)
        return jsonResponse(statusResponse(40), {
          ETag: '"status-v1"',
          Expires: new Date(now + 1_000).toUTCString(),
        })
      return new Response(null, {
        status: 304,
        headers: {
          ETag: '"status-v2"',
          Expires: new Date(now + 5_000).toUTCString(),
        },
      })
    })
    const ports = createRuntimeTestPorts({
      response: statusResponse(0),
      fetch,
      overrides: {
        coordination: coordinatedOverrides({
          acquireRequestLease: vi.fn(async () => ({ ...ownerLease, fence: ++fence })),
          commitFence: vi.fn(async () => true),
        }),
        timing: { now: () => now },
      },
    })
    const runtime = createRuntimeTestExecution(ports)
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)
    await statusRead.execute({})
    now += 2_000

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
        response: 0,
        fetch,
        overrides: { authorization: { getAuthorization, getCacheAuthorization } },
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
      if (!repairRevision) throw new Error('coordination unavailable')
      return 9
    })
    const fetch = vi
      .fn()
      .mockReturnValueOnce(new Response(null, { status: 204 }))
      .mockReturnValueOnce(jsonResponse({ labels: [], total_unread_count: 3 }))
    const mutationRelease = vi.fn()
    const acquireRequestPermit = vi.fn(async () => requestPermit(mutationRelease))
    const ports = createRuntimeTestPorts({
      response: undefined,
      fetch,
      overrides: {
        cache: {
          get: async (key) => cache.get(key) ?? null,
          set: cacheSet,
          delete: cacheDelete,
        },
        coordination: coordinatedOverrides({
          acquireRequestLease: vi.fn(async () => ownerLease),
          commitFence: vi.fn(async () => true),
          incrementResourceRevision,
          acquireRequestPermit,
        }),
      },
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
        response: undefined,
        fetch,
        overrides: {
          coordination: { acquireRequestPermit, incrementResourceRevision },
        },
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)

    await expect(
      deleteMail.execute({ characterId, mailId: 50, subjectLifecycleId }),
    ).rejects.toMatchObject({ code: 'ESI_TRANSPORT_ERROR', cause: failure })

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
        response: undefined,
        fetch,
        overrides: {
          coordination: { acquireRequestPermit, incrementResourceRevision },
        },
      }),
    )
    runtimeMocks.getProductionRuntime.mockResolvedValue(runtime)
    const caught = deleteMail
      .execute({ characterId, mailId: 50, subjectLifecycleId, signal: controller.signal })
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
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function requestPermit(release = vi.fn()) {
  return {
    coordinationAvailable: false,
    ttlMs: 30_000,
    renew: vi.fn(async () => true),
    release,
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
