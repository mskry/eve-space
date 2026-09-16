import {
  hydrateQueryCache,
  PiniaColada,
  useQuery,
  useQueryCache,
  type EntryKey,
  type QueryCache,
} from '@pinia/colada'
import { resetCacheReady } from '@pinia/colada-plugin-cache-persister'
import { PiniaColadaRetry } from '@pinia/colada-plugin-retry'
import { createPinia, disposePinia } from 'pinia'
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyVerifiedQueryIdentity,
  awaitQueryPersistenceRestoration,
  installQueryPersistence,
  invalidatePrivateQueryScope,
  readQueryPersistenceState,
  refreshPrivateQueryAdmission,
  reportPrivateQueryAuthorizationDenial,
  signalNuxtHydrationFinished,
  subscribePrivateQueryInvalidation,
  suspendPrivateQueryAdmission,
} from '../../app/query-persistence/runtime'
import type {
  QueryPersistenceNotification,
  QueryPersistenceNotifications,
} from '../../app/query-persistence/notifications'
import type {
  QueryPersistenceStorage,
  QueryPersistenceStorageWrite,
} from '../../app/query-persistence/storage'
import type {
  EsiQueryCacheEnvelope,
  PersistedQueryTuple,
  PrivateQueryInvalidationScope,
} from '../../app/query-persistence/envelope'
import { PERSISTED_ESI_QUERY_CACHE_RETENTION_MS } from '../../app/query-persistence/envelope'
import type { CacheAdmissionContext } from '../../app/queries/auth'
import { prefetchProtectedQuery } from '../../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { ApiQueryError } from '../../app/utils/query-error'

const NOW = Date.parse('2026-09-14T11:00:00.000Z')
const PUBLIC_KEY = ['public', 'characters', 7] as const
const CHARACTER_KEY = ['private', 'characters', 7, 'overview'] as const
const CHARACTER_SIBLING_KEY = ['private', 'characters', 7, 'wallet'] as const
const ORGANIZATION_KEY = ['private', 'organization', 'activities'] as const
const ORGANIZATION_SCOPE = 'organization:v1:core:member:organization.activities'
const protectedAccess = {
  authenticated: true,
  authenticationReady: true,
  isClient: true,
  ownsCharacter: true,
}

beforeEach(() => {
  resetCacheReady()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('query persistence runtime', () => {
  it('settles without the persister when storage is unavailable', async () => {
    const runtime = createRuntime(unavailableStorage)
    await readyRuntime(runtime)
    const entry = runtime.queryCache.ensure({
      key: CHARACTER_KEY,
      query: async () => ({ name: 'Live' }),
      meta: { esiPersistence: { kind: 'character-esi', characterId: 7 } },
    })

    await runtime.queryCache.fetch(entry)

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Live' })
    runtime.dispose()
  })

  it('uses the official persister while quarantining private data through hydration', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)

    await awaitQueryPersistenceRestoration(runtime.queryCache)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()

    const applying = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession(),
      async () => admission(),
    )
    await vi.waitFor(() => expect(storage.generationReads).toBe(1))
    await runtime.activatePrivateQuery()
    const characterEntry = runtime.queryCache.get(CHARACTER_KEY)

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    signalNuxtHydrationFinished(runtime.queryCache)
    await expect(applying).resolves.toBe(true)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public' })
    expect(runtime.queryCache.get(PUBLIC_KEY)?.ext.isRetrying).toBeDefined()
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' })
    expect(runtime.queryCache.get(CHARACTER_KEY)).toBe(characterEntry)
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toEqual({ name: 'Organization' })
    expect(readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value).toEqual({
      kind: 'restored',
      originalSuccessAt: new Date(NOW - 60_000).toISOString(),
      retainedPrivateAccess: true,
    })
    runtime.dispose()
  })

  it('does not report restored provenance when a private tuple is revoked while awaiting hydration', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await awaitQueryPersistenceRestoration(runtime.queryCache)
    const applying = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession(),
      async () => admission(),
    )
    await vi.waitFor(() => expect(storage.generationReads).toBe(1))

    await invalidatePrivateQueryScope(runtime.queryCache, { kind: 'character', characterId: 7 })
    signalNuxtHydrationFinished(runtime.queryCache)

    await expect(applying).resolves.toBe(false)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value).toEqual({
      kind: 'fresh',
      retainedPrivateAccess: false,
    })
    runtime.dispose()
  })

  it('does not report restored provenance when a private tuple expires while awaiting hydration', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const envelope = envelopeWithPrivatePartitions()
    envelope.characters['7']!.cache[JSON.stringify(CHARACTER_KEY)]![2] =
      NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS + 1_000
    const storage = new MemoryQueryPersistenceStorage(envelope)
    const runtime = createRuntime(storage, undefined, Date.now)
    await awaitQueryPersistenceRestoration(runtime.queryCache)
    const applying = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession(),
      async () => admission(),
    )
    await vi.waitFor(() => expect(storage.generationReads).toBe(1))

    await vi.advanceTimersByTimeAsync(1_000)
    signalNuxtHydrationFinished(runtime.queryCache)

    await expect(applying).resolves.toBe(true)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value).toEqual({
      kind: 'fresh',
      retainedPrivateAccess: false,
    })
    runtime.dispose()
  })

  it('prefetches live private data without a retained-cache admission', async () => {
    const runtime = createRuntime(new MemoryQueryPersistenceStorage())
    await readyRuntime(runtime)
    const query = vi.fn().mockResolvedValue({ name: 'Prefetched' })

    await prefetchProtectedQuery(runtime.queryCache, characterPrefetch(query), protectedAccess, 7)

    expect(query).toHaveBeenCalledOnce()
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Prefetched' })
    runtime.dispose()
  })

  it('does not let prefetch reuse retained private data after admission lapses', async () => {
    let currentTime = NOW
    const runtime = createRuntime(
      new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions()),
      undefined,
      () => currentTime,
    )
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' })
    const query = vi.fn().mockResolvedValue({ name: 'Prefetched' })

    currentTime += 30_001
    await prefetchProtectedQuery(runtime.queryCache, characterPrefetch(query), protectedAccess, 7)

    expect(query).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('applies delayed restoration after hydration and settles readiness before mount', async () => {
    const storage = new DeferredReadStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, () => NOW, false)
    signalNuxtHydrationFinished(runtime.queryCache)
    let ready = false
    const restoration = awaitQueryPersistenceRestoration(runtime.queryCache).then(() => {
      ready = true
    })
    await Promise.resolve()

    expect(ready).toBe(false)
    storage.releaseRead()
    await restoration

    expect(ready).toBe(true)
    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public' })
    runtime.mount()
    runtime.dispose()
  })

  it('keeps a current fetch result over a staged public fallback', async () => {
    const runtime = createRuntime(
      new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions()),
    )
    await awaitQueryPersistenceRestoration(runtime.queryCache)
    const entry = ensurePublicQuery(runtime.queryCache, async () => ({ name: 'Current' }))

    await runtime.queryCache.fetch(entry)
    signalNuxtHydrationFinished(runtime.queryCache)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Current' })
    expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toMatchObject({
      kind: 'fresh',
      originalSuccessAt: new Date(NOW).toISOString(),
    })
    runtime.dispose()
  })

  it('discards a public fallback that expires while staged', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const envelope = envelopeWithPrivatePartitions()
    envelope.public[JSON.stringify(PUBLIC_KEY)]![2] =
      NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS + 1_000
    const storage = new MemoryQueryPersistenceStorage(envelope)
    const runtime = createRuntime(storage, undefined, Date.now)
    await awaitQueryPersistenceRestoration(runtime.queryCache)

    await vi.advanceTimersByTimeAsync(1_000)
    signalNuxtHydrationFinished(runtime.queryCache)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toBeUndefined()
    expect(storage.snapshot()?.public).toEqual({})
    runtime.dispose()
  })

  it('purges only the partition whose admission binding changed', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)

    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission({ characterRevision: 'character-revision-2' }),
    )

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toEqual({ name: 'Organization' })
    expect(storage.snapshot()).toMatchObject({
      invalidationGeneration: 1,
      characters: {},
      organizations: envelopeWithPrivatePartitions().organizations,
    })
    runtime.dispose()
  })

  it('expires retained private data after the 30-second admission window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )

    await vi.advanceTimersByTimeAsync(29_999)
    expect(
      readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value.retainedPrivateAccess,
    ).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined())
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    expect(
      readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value.retainedPrivateAccess,
    ).toBe(false)
    runtime.dispose()
  })

  it('uses an earlier organization deadline for character and organization retained data', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const validUntil = new Date(NOW + 10_000).toISOString()
    const envelope = envelopeWithPrivatePartitions()
    envelope.organizations[ORGANIZATION_SCOPE] = {
      ...envelope.organizations[ORGANIZATION_SCOPE]!,
      validUntil,
    }
    const storage = new MemoryQueryPersistenceStorage(envelope)
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission({ organizationValidUntil: validUntil }),
    )

    await vi.advanceTimersByTimeAsync(9_999)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' })
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toEqual({ name: 'Organization' })

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined())
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    runtime.dispose()
  })

  it('keeps live private queries and persisted data when the admission window lapses', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    const rosterKey = PRIVATE_QUERY_KEYS.roster()
    runtime.queryCache.ensure({ key: rosterKey, query: async () => ({ characters: [7] }) })
    runtime.queryCache.setQueryData(rosterKey, { characters: [7] })
    const loadAdmission = vi.fn(async () => admission())
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined())

    expect(runtime.queryCache.getQueryData(rosterKey)).toEqual({ characters: [7] })
    expect(storage.invalidationCalls).toBe(0)
    await expect(
      applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission),
    ).resolves.toBe(true)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' })
    runtime.dispose()
  })

  it('re-admits retained data on focus after a slept-through admission window', async () => {
    let currentTime = NOW
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, () => currentTime)
    await readyRuntime(runtime)
    const rosterKey = PRIVATE_QUERY_KEYS.roster()
    runtime.queryCache.ensure({ key: rosterKey, query: async () => ({ characters: [7] }) })
    runtime.queryCache.setQueryData(rosterKey, { characters: [7] })
    const loadAdmission = vi.fn(async () => admission())
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    currentTime += 31_000

    globalThis.dispatchEvent(new Event('focus'))

    await vi.waitFor(() => expect(loadAdmission).toHaveBeenCalledTimes(2))
    await vi.waitFor(() =>
      expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' }),
    )
    expect(runtime.queryCache.getQueryData(rosterKey)).toEqual({ characters: [7] })
    expect(storage.invalidationCalls).toBe(0)
    runtime.dispose()
  })

  it('invalidates live private data on focus when the renewed admission revision changed', async () => {
    let currentTime = NOW
    const privateQuery = vi.fn().mockResolvedValue({ name: 'Live private' })
    const storage = new MemoryQueryPersistenceStorage()
    const runtime = createRuntime(storage, undefined, () => currentTime, true, privateQuery)
    await readyRuntime(runtime)
    const loadAdmission = vi
      .fn()
      .mockResolvedValueOnce(admission())
      .mockResolvedValue(admission({ characterRevision: 'character-revision-2' }))
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledOnce())
    const invalidateCharacterScope = vi.fn()
    subscribePrivateQueryInvalidation(
      runtime.queryCache,
      { kind: 'character', characterId: 7 },
      invalidateCharacterScope,
    )
    currentTime += 31_000

    globalThis.dispatchEvent(new Event('focus'))

    await vi.waitFor(() => expect(loadAdmission).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(invalidateCharacterScope).toHaveBeenCalled())
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledTimes(2))
    expect(storage.invalidationCalls).toBe(1)
    runtime.dispose()
  })

  it('invalidates a changed revision after a transient admission failure', async () => {
    let currentTime = NOW
    const privateQuery = vi.fn().mockResolvedValue({ name: 'Live private' })
    const storage = new MemoryQueryPersistenceStorage()
    const runtime = createRuntime(storage, undefined, () => currentTime, true, privateQuery)
    await readyRuntime(runtime)
    const loadAdmission = vi
      .fn()
      .mockResolvedValueOnce(admission())
      .mockRejectedValueOnce(new TypeError('Admission is unreachable.'))
      .mockResolvedValue(admission({ characterRevision: 'character-revision-2' }))
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledOnce())

    currentTime += 31_000
    globalThis.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(loadAdmission).toHaveBeenCalledTimes(2))

    const invalidateCharacterScope = vi.fn()
    subscribePrivateQueryInvalidation(
      runtime.queryCache,
      { kind: 'character', characterId: 7 },
      invalidateCharacterScope,
    )
    currentTime += 31_000
    globalThis.dispatchEvent(new Event('focus'))

    await vi.waitFor(() => expect(loadAdmission).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(invalidateCharacterScope).toHaveBeenCalled())
    runtime.dispose()
  })

  it('joins an overlapping resume check instead of restarting admission', async () => {
    let currentTime = NOW
    const privateQuery = vi.fn().mockResolvedValue({ name: 'Live private' })
    const storage = new MemoryQueryPersistenceStorage()
    const runtime = createRuntime(storage, undefined, () => currentTime, true, privateQuery)
    await readyRuntime(runtime)
    const renewedAdmission = Promise.withResolvers<CacheAdmissionContext>()
    const loadAdmission = vi
      .fn()
      .mockResolvedValueOnce(admission())
      .mockReturnValueOnce(renewedAdmission.promise)
      .mockResolvedValue(admission())
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledOnce())
    const invalidateCharacterScope = vi.fn()
    subscribePrivateQueryInvalidation(
      runtime.queryCache,
      { kind: 'character', characterId: 7 },
      invalidateCharacterScope,
    )

    currentTime += 31_000
    globalThis.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(loadAdmission).toHaveBeenCalledTimes(2))
    globalThis.dispatchEvent(new Event('focus'))
    renewedAdmission.resolve(admission({ characterRevision: 'character-revision-2' }))

    await vi.waitFor(() => expect(invalidateCharacterScope).toHaveBeenCalled())
    expect(loadAdmission).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('honors a re-driven private request after a queued lifecycle recheck', async () => {
    let currentTime = NOW
    const deniedRefetch = Promise.withResolvers<unknown>()
    const privateQuery = vi
      .fn()
      .mockResolvedValueOnce({ name: 'Live private' })
      .mockReturnValueOnce(deniedRefetch.promise)
      .mockResolvedValue({ name: 'Live private' })
    const storage = new MemoryQueryPersistenceStorage()
    const runtime = createRuntime(storage, undefined, () => currentTime, true, privateQuery)
    await readyRuntime(runtime)
    const renewedAdmission = Promise.withResolvers<CacheAdmissionContext>()
    const loadAdmission = vi
      .fn()
      .mockResolvedValueOnce(admission())
      .mockReturnValueOnce(renewedAdmission.promise)
      .mockResolvedValue(admission({ characterRevision: 'character-revision-2' }))
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledOnce())

    currentTime += 31_000
    globalThis.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(loadAdmission).toHaveBeenCalledTimes(2))
    globalThis.dispatchEvent(new Event('focus'))
    renewedAdmission.resolve(admission({ characterRevision: 'character-revision-2' }))

    await vi.waitFor(() => expect(storage.invalidationCalls).toBe(1))
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledTimes(2))
    deniedRefetch.reject(authorizationDenial('EVE_REAUTH_REQUIRED'))

    await vi.waitFor(() => expect(storage.invalidationCalls).toBe(2))
    runtime.dispose()
  })

  it('keeps live private data usable on focus when storage is unavailable', async () => {
    let currentTime = NOW
    const privateQuery = vi.fn().mockResolvedValue({ name: 'Live private' })
    const runtime = createRuntime(
      unavailableStorage,
      undefined,
      () => currentTime,
      true,
      privateQuery,
    )
    await readyRuntime(runtime)
    const loadAdmission = vi.fn(async () => admission())
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledOnce())
    expect(runtime.queryCache.getQueryData(CHARACTER_SIBLING_KEY)).toEqual({ name: 'Live private' })

    currentTime += 31_000
    globalThis.dispatchEvent(new Event('focus'))

    await vi.waitFor(() => expect(loadAdmission).toHaveBeenCalledTimes(2))
    await vi.waitFor(() =>
      expect(runtime.queryCache.getQueryData(CHARACTER_SIBLING_KEY)).toEqual({
        name: 'Live private',
      }),
    )
    runtime.dispose()
  })

  it('keeps live private access when the durable generation becomes unverifiable', async () => {
    let currentTime = NOW
    const privateQuery = vi.fn().mockResolvedValue({ name: 'Live private' })
    const storage = new FailingGenerationStorage()
    const runtime = createRuntime(storage, undefined, () => currentTime, true, privateQuery)
    await readyRuntime(runtime)
    const loadAdmission = vi.fn(async () => admission())
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledOnce())

    storage.failGenerationReads()
    const privateWritesBefore = storage.privateWritePermissions.length
    currentTime += 31_000
    globalThis.dispatchEvent(new Event('focus'))

    await vi.waitFor(() => expect(loadAdmission).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledTimes(2))
    expect(
      readQueryPersistenceState(runtime.queryCache, CHARACTER_SIBLING_KEY).value
        .retainedPrivateAccess,
    ).toBe(false)
    expect(storage.privateWritePermissions.slice(privateWritesBefore)).not.toContain(true)
    runtime.dispose()
  })

  it('invalidates retained data whose binding changed while admission was suspended', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined())

    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission({ characterRevision: 'character-revision-2' }),
    )

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toEqual({ name: 'Organization' })
    expect(storage.snapshot()).toMatchObject({ characters: {}, invalidationGeneration: 1 })
    runtime.dispose()
  })

  it('renews admission five seconds before expiry for active restored data', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    const loadAdmission = vi.fn().mockResolvedValue(admission())
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()

    await vi.advanceTimersByTimeAsync(25_000)

    expect(loadAdmission).toHaveBeenCalledTimes(2)
    expect(
      readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value.retainedPrivateAccess,
    ).toBe(true)
    runtime.dispose()
  })

  it('discovers a revoked character revision during scheduled renewal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    const loadAdmission = vi
      .fn()
      .mockResolvedValueOnce(admission())
      .mockResolvedValueOnce(admission({ characterRevision: null }))
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()

    await vi.advanceTimersByTimeAsync(25_000)

    expect(loadAdmission).toHaveBeenCalledTimes(2)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toEqual({ name: 'Organization' })
    expect(storage.snapshot()).toMatchObject({ characters: {}, invalidationGeneration: 1 })
    runtime.dispose()
  })

  it('keeps the verified session and live-query path when scheduled renewal rejects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    const loadAdmission = vi
      .fn()
      .mockResolvedValueOnce(admission())
      .mockRejectedValueOnce(new Error('Admission unavailable.'))
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()

    await vi.advanceTimersByTimeAsync(25_000)

    expect(runtime.queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(
      authenticatedSession(),
    )
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(storage.invalidationCalls).toBe(0)
    const liveEntry = ensurePrivateQuery(runtime.queryCache, async () => ({ name: 'Live result' }))
    await runtime.queryCache.fetch(liveEntry)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Live result' })
    runtime.dispose()
  })

  it('restores retained private data once admission recovers from an unreachable API', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)

    await expect(
      applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).resolves.toBe(false)

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(storage.invalidationCalls).toBe(0)
    expect(notifications.published).toEqual([])

    await expect(
      applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
        admission(),
      ),
    ).resolves.toBe(true)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' })
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toEqual({ name: 'Organization' })
    runtime.dispose()
  })

  it('purges retained private data when admission denies authentication', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)

    await expect(
      applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () => {
        throw new ApiQueryError('Authentication required.', {
          status: 401,
          code: 'AUTH_REQUIRED',
        })
      }),
    ).resolves.toBe(false)

    expect(storage.invalidationCalls).toBe(1)
    expect(notifications.published).toEqual([{ generation: 1, scope: { kind: 'all' } }])
    await expect(
      applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
        admission(),
      ),
    ).resolves.toBe(true)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    runtime.dispose()
  })

  it('suspends admitted private data without invalidating persisted data', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' })

    suspendPrivateQueryAdmission(runtime.queryCache)

    expect(
      readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value.retainedPrivateAccess,
    ).toBe(false)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(storage.invalidationCalls).toBe(0)
    await expect(
      applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
        admission(),
      ),
    ).resolves.toBe(true)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' })
    runtime.dispose()
  })

  it.each([
    ['30-second client deadline', 30_000, admission()],
    [
      'earlier organization deadline',
      5_000,
      admission({ organizationValidUntil: new Date(NOW + 5_000).toISOString() }),
    ],
  ] as const)('rejects an admission response arriving at its %s', async (_label, delay, result) => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    const pendingAdmission = deferred<CacheAdmissionContext>()
    const applying = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession(),
      () => pendingAdmission.promise,
    )

    await vi.advanceTimersByTimeAsync(delay)
    pendingAdmission.resolve(result)

    await expect(applying).resolves.toBe(false)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    runtime.dispose()
  })

  it('clears stale owner data synchronously before admitting a different user', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeDefined()

    const changed = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession('user-2'),
      async () => admission({ userId: 'user-2' }),
    )

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    await changed
    expect(runtime.queryCache.getQueryData(['private', 'session'])).toEqual(
      authenticatedSession('user-2'),
    )
    runtime.dispose()
  })

  it.each([
    {
      label: 'logout',
      session: { authenticated: false as const },
      nextAdmission: null,
      characterRetained: false,
      organizationRetained: false,
    },
    {
      label: 'user switch',
      session: authenticatedSession('user-2'),
      nextAdmission: admission({ userId: 'user-2' }),
      characterRetained: false,
      organizationRetained: false,
    },
    {
      label: 'character revision',
      session: authenticatedSession(),
      nextAdmission: admission({ characterRevision: 'character-revision-2' }),
      characterRetained: false,
      organizationRetained: true,
    },
    {
      label: 'organization version',
      session: authenticatedSession(),
      nextAdmission: admission({ organizationVersion: 4 }),
      characterRetained: true,
      organizationRetained: false,
    },
    {
      label: 'organization revision',
      session: authenticatedSession(),
      nextAdmission: admission({ organizationRevision: 'organization-revision-2' }),
      characterRetained: true,
      organizationRetained: false,
    },
    {
      label: 'module scope removal',
      session: authenticatedSession(),
      nextAdmission: admission({ admissionScopes: [] }),
      characterRetained: true,
      organizationRetained: false,
    },
  ])(
    'keeps control and public data durable through $label cleanup without resurrection',
    async ({ session, nextAdmission, characterRetained, organizationRetained }) => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
      const runtime = createRuntime(storage, undefined, Date.now)
      await readyRuntime(runtime)
      await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
        admission(),
      )

      await applyVerifiedQueryIdentity(
        runtime.queryCache,
        session,
        nextAdmission ? async () => nextAdmission : undefined,
      )

      expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public' })
      expect(runtime.queryCache.getQueryData(CHARACTER_KEY) !== undefined).toBe(characterRetained)
      expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY) !== undefined).toBe(
        organizationRetained,
      )
      expect(storage.currentGeneration).toBe(1)
      expect(storage.snapshot()?.public[JSON.stringify(PUBLIC_KEY)]?.[0]).toEqual({
        name: 'Public',
      })
      await vi.advanceTimersByTimeAsync(1_000)
      runtime.dispose()

      const reloaded = createRuntime(storage, undefined, Date.now)
      await readyRuntime(reloaded)
      if (nextAdmission) {
        await applyVerifiedQueryIdentity(reloaded.queryCache, session, async () => nextAdmission)
      }
      expect(reloaded.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public' })
      expect(reloaded.queryCache.getQueryData(CHARACTER_KEY) !== undefined).toBe(characterRetained)
      expect(reloaded.queryCache.getQueryData(ORGANIZATION_KEY) !== undefined).toBe(
        organizationRetained,
      )
      expect(storage.currentGeneration).toBe(1)
      reloaded.dispose()
    },
  )

  it('purges a scope-denied retained partition without resetting successful live state', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const resetConsumerState = vi.fn()
    subscribePrivateQueryInvalidation(
      runtime.queryCache,
      { kind: 'character', characterId: 7 },
      resetConsumerState,
    )
    const siblingEntry = runtime.queryCache.ensure({
      key: CHARACTER_SIBLING_KEY,
      query: async () => ({ balance: 100 }),
      staleTime: 0,
      meta: { esiPersistence: { kind: 'character-esi', characterId: 7 } },
    })
    await runtime.queryCache.fetch(siblingEntry)
    const scopeError = new ApiQueryError('Character scope required.', {
      status: 403,
      code: 'EVE_SCOPE_REQUIRED',
    })
    const deniedEntry = ensurePrivateQuery(runtime.queryCache, async () => {
      throw scopeError
    })

    await expect(runtime.queryCache.fetch(deniedEntry)).rejects.toBe(scopeError)
    await vi.waitFor(() => expect(storage.invalidationCalls).toBe(1))

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(CHARACTER_SIBLING_KEY)).toEqual({ balance: 100 })
    expect(resetConsumerState).not.toHaveBeenCalled()
    expect(storage.snapshot()?.characters).toEqual({})
    runtime.dispose()
  })

  it('keeps consumer state when a mutation reports a missing write scope', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const resetConsumerState = vi.fn()
    const scope = { kind: 'character', characterId: 7 } as const
    subscribePrivateQueryInvalidation(runtime.queryCache, scope, resetConsumerState)

    expect(
      reportPrivateQueryAuthorizationDenial(
        runtime.queryCache,
        scope,
        authorizationDenial('EVE_SCOPE_REQUIRED'),
      ),
    ).toBe(true)
    expect(resetConsumerState).not.toHaveBeenCalled()
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    await vi.waitFor(() => expect(storage.invalidationCalls).toBe(1))

    reportPrivateQueryAuthorizationDenial(
      runtime.queryCache,
      scope,
      authorizationDenial('EVE_REAUTH_REQUIRED'),
    )
    expect(resetConsumerState).toHaveBeenCalledOnce()
    runtime.dispose()
  })

  it('ignores an obsolete prior-owner admission after the next owner is admitted', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const priorOwnerAdmission = deferred<CacheAdmissionContext>()

    const priorOwnerApplying = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession(),
      () => priorOwnerAdmission.promise,
    )
    const nextOwnerApplying = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession('user-2'),
      async () => admission({ userId: 'user-2' }),
    )
    await expect(nextOwnerApplying).resolves.toBe(true)
    runtime.queryCache.setQueryData(CHARACTER_KEY, { name: 'User 2' })
    const generationAfterNextOwner = storage.currentGeneration
    const publicationsAfterNextOwner = notifications.published.length

    priorOwnerAdmission.resolve(admission())

    await expect(priorOwnerApplying).resolves.toBe(false)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'User 2' })
    expect(runtime.queryCache.getQueryData(['private', 'session'])).toEqual(
      authenticatedSession('user-2'),
    )
    expect(storage.currentGeneration).toBe(generationAfterNextOwner)
    expect(notifications.published).toHaveLength(publicationsAfterNextOwner)
    runtime.dispose()
  })

  it('fails closed when the current owner admission response names another owner', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )

    await expect(
      applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
        admission({ userId: 'user-2' }),
      ),
    ).resolves.toBe(false)

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    expect(storage.invalidationCalls).toBe(1)
    expect(notifications.published).toEqual([{ generation: 1, scope: { kind: 'all' } }])
    runtime.dispose()
  })

  it('does not let a stale rejected loader invalidate a newer lifecycle', async () => {
    const storage = new MemoryQueryPersistenceStorage()
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    const loading = deferred<CacheAdmissionContext>()
    const applying = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession(),
      () => loading.promise,
    )

    await expect(invalidatePrivateQueryScope(runtime.queryCache)).resolves.toBe(true)
    loading.reject(new Error('Obsolete admission failed.'))

    await expect(applying).resolves.toBe(false)
    expect(storage.invalidationCalls).toBe(1)
    expect(notifications.published).toEqual([{ generation: 1, scope: { kind: 'all' } }])
    runtime.dispose()
  })

  it('guards a delayed generation verification from a later invalidation', async () => {
    const storage = new DeferredGenerationStorage()
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    const applying = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession(),
      async () => admission(),
    )
    await vi.waitFor(() => expect(storage.generationReads).toBe(1))

    await expect(invalidatePrivateQueryScope(runtime.queryCache)).resolves.toBe(true)
    storage.releaseGeneration(0)

    await expect(applying).resolves.toBe(false)
    expect(storage.currentGeneration).toBe(1)
    expect(storage.invalidationCalls).toBe(1)
    expect(notifications.published).toEqual([{ generation: 1, scope: { kind: 'all' } }])
    runtime.dispose()
  })

  it('purges synchronously and ignores a durable invalidation completed after a newer epoch', async () => {
    const storage = new DeferredInvalidationStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )

    const first = invalidatePrivateQueryScope(runtime.queryCache, {
      kind: 'character',
      characterId: 7,
    })
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(
      readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value.retainedPrivateAccess,
    ).toBe(false)

    await expect(
      invalidatePrivateQueryScope(runtime.queryCache, { kind: 'organization' }),
    ).resolves.toBe(true)
    runtime.queryCache.setQueryData(CHARACTER_KEY, { name: 'New epoch' })
    storage.releaseFirstInvalidation()

    await expect(first).resolves.toBe(false)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'New epoch' })
    expect(notifications.published).toEqual([{ generation: 2, scope: { kind: 'all' } }])
    runtime.dispose()
  })

  it('keeps private persistence closed when durable invalidation fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new FailingInvalidationStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const writesBeforeInvalidation = storage.privateWritePermissions.length

    const invalidating = invalidatePrivateQueryScope(runtime.queryCache)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    await expect(invalidating).resolves.toBe(false)
    const entry = ensurePrivateQuery(runtime.queryCache, async () => ({ name: 'Must not persist' }))
    await runtime.queryCache.fetch(entry)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(storage.privateWritePermissions.length).toBeGreaterThan(writesBeforeInvalidation)
    expect(storage.privateWritePermissions.at(-1)).toBe(false)
    expect(notifications.published).toEqual([{ generation: null, scope: { kind: 'all' } }])
    expect(
      readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value.retainedPrivateAccess,
    ).toBe(false)
    runtime.dispose()
  })

  it('treats a cross-tab generation gap as a full invalidation', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    storage.setGeneration(2)

    notifications.emit({ generation: 2, scope: { kind: 'character', characterId: 7 } })

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    runtime.dispose()
  })

  it.each([
    {
      label: 'character denial',
      kind: 'character' as const,
      error: new ApiQueryError('Character reauthorization required.', {
        status: 403,
        code: 'EVE_REAUTH_REQUIRED',
      }),
      characterRetained: false,
      organizationRetained: true,
    },
    {
      label: 'organization denial',
      kind: 'organization' as const,
      error: new ApiQueryError('Organization access denied.', {
        status: 403,
        code: 'ORGANIZATION_PERMISSION_REQUIRED',
      }),
      characterRetained: true,
      organizationRetained: false,
    },
    {
      label: 'session denial',
      kind: 'character' as const,
      error: new ApiQueryError('Authentication required.', {
        status: 401,
        code: 'AUTH_REQUIRED',
      }),
      characterRetained: false,
      organizationRetained: false,
    },
  ])(
    'purges an authoritative $label before renewal while preserving its structured error',
    async ({ kind, error, characterRetained, organizationRetained }) => {
      const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
      const runtime = createRuntime(storage)
      await readyRuntime(runtime)
      await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
        admission(),
      )
      const entry =
        kind === 'character'
          ? ensurePrivateQuery(runtime.queryCache, async () => {
              throw error
            })
          : ensureOrganizationQuery(runtime.queryCache, async () => {
              throw error
            })

      await expect(runtime.queryCache.fetch(entry)).rejects.toBe(error)
      await vi.waitFor(() => expect(storage.invalidationCalls).toBe(1))

      expect(entry.state.value.error).toBe(error)
      expect(entry.state.value.data).toBeUndefined()
      expect(runtime.queryCache.getQueryData(CHARACTER_KEY) !== undefined).toBe(characterRetained)
      expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY) !== undefined).toBe(
        organizationRetained,
      )
      expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public' })
      runtime.dispose()
    },
  )

  it('cancels a mounted pending private result and ignores its late completion', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    await runtime.activatePrivateQuery()
    const pendingResult = deferred<{ name: string }>()
    const entry = ensurePrivateQuery(runtime.queryCache, () => pendingResult.promise)
    const fetching = runtime.queryCache.fetch(entry)
    await vi.waitFor(() => expect(entry.pending).not.toBeNull())

    await invalidatePrivateQueryScope(runtime.queryCache, { kind: 'character', characterId: 7 })
    pendingResult.resolve({ name: 'Obsolete result' })
    await fetching
    await nextTick()

    expect(entry.pending).toBeNull()
    expect(entry.state.value.data).toBeUndefined()
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(storage.snapshot()?.characters).toEqual({})
    runtime.dispose()
  })

  it('re-drives a parked mounted private query when admission re-opens', async () => {
    const privateQuery = vi.fn().mockResolvedValue({ name: 'Current private' })
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, undefined, true, privateQuery)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    await runtime.activatePrivateQuery()
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledOnce())
    const entry = runtime.queryCache.get(CHARACTER_SIBLING_KEY)!

    await invalidatePrivateQueryScope(runtime.queryCache, { kind: 'character', characterId: 7 })
    await nextTick()

    expect(privateQuery).toHaveBeenCalledOnce()
    expect(entry.state.value).toEqual({ status: 'pending', data: undefined, error: null })
    expect(entry.when).toBe(0)

    await refreshPrivateQueryAdmission(runtime.queryCache, { kind: 'character', characterId: 7 })
    await vi.waitFor(() => expect(privateQuery).toHaveBeenCalledTimes(2))
    await nextTick()

    expect(runtime.queryCache.getQueryData(CHARACTER_SIBLING_KEY)).toEqual({
      name: 'Current private',
    })
    runtime.dispose()
  })

  it('does not let an obsolete private completion purge a newer-generation success', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const pendingResult = deferred<{ name: string }>()
    const entry = ensurePrivateQuery(runtime.queryCache, () => pendingResult.promise)
    const obsoleteFetch = runtime.queryCache.fetch(entry)
    await vi.waitFor(() => expect(entry.pending).not.toBeNull())

    await invalidatePrivateQueryScope(runtime.queryCache, { kind: 'character', characterId: 7 })
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const currentEntry = ensurePrivateQuery(runtime.queryCache, async () => ({ name: 'Current' }))
    await runtime.queryCache.fetch(currentEntry)
    pendingResult.resolve({ name: 'Obsolete' })
    await obsoleteFetch

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Current' })
    runtime.dispose()
  })

  it('rejects restored private partitions whose envelope generation was not verified', async () => {
    const storage = new MismatchedRestorationStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)

    await expect(
      applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
        admission(),
      ),
    ).resolves.toBe(true)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public' })
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    runtime.dispose()
  })

  it('closes admitted data when a private write observes a generation gap', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new GenerationGapWriteStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const writesBeforeGap = storage.privateWritePermissions.length
    storage.enableGap()

    const entry = ensurePrivateQuery(runtime.queryCache, async () => ({ name: 'Generation gap' }))
    await runtime.queryCache.fetch(entry)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(storage.privateWritePermissions.length).toBeGreaterThan(writesBeforeGap)
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(storage.privateWritePermissions[writesBeforeGap]).toBe(true)
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    runtime.dispose()
  })

  it.each(['rejected', 'quota'] as const)(
    'keeps private persistence closed after a same-generation %s write while live queries and public writes continue',
    async (failure) => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const storage = new RejectingPrivateWriteStorage()
      const runtime = createRuntime(storage, undefined, Date.now)
      await readyRuntime(runtime)
      await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
        admission(),
      )
      storage.rejectNextPrivateWrite(failure)
      let publicName = 'Public after failure'
      const publicEntry = ensurePublicQuery(runtime.queryCache, async () => ({ name: publicName }))
      const privateEntry = ensurePrivateQuery(runtime.queryCache, async () => ({
        name: 'Private before failure',
      }))

      await runtime.queryCache.fetch(publicEntry)
      await runtime.queryCache.fetch(privateEntry)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(runtime.queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(
        authenticatedSession(),
      )
      expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()

      publicName = 'Public after closure'
      await runtime.queryCache.fetch(publicEntry)
      await runtime.queryCache.fetch(privateEntry)
      await vi.advanceTimersByTimeAsync(2_000)

      expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public after closure' })
      expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({
        name: 'Private before failure',
      })
      expect(storage.privateWritePermissions.at(-1)).toBe(false)
      expect(storage.snapshot()).toMatchObject({
        public: {
          [JSON.stringify(PUBLIC_KEY)]: [
            { name: 'Public after closure' },
            null,
            expect.any(Number),
            expect.anything(),
          ],
        },
        characters: {},
        organizations: {},
      })

      runtime.dispose()
      const reloaded = createRuntime(storage, undefined, Date.now)
      await readyRuntime(reloaded)
      expect(reloaded.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public after closure' })
      await applyVerifiedQueryIdentity(reloaded.queryCache, authenticatedSession(), async () =>
        admission(),
      )
      expect(reloaded.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
      reloaded.dispose()
    },
  )

  it('physically removes an unsupported envelope without advancing durable generation', async () => {
    const storage = new MemoryQueryPersistenceStorage()
    storage.setGeneration(4)
    storage.setRaw(
      JSON.stringify({ ...envelopeWithPrivatePartitions(), version: 2, invalidationGeneration: 4 }),
    )
    const runtime = createRuntime(storage)

    await readyRuntime(runtime)

    expect(storage.removeCalls).toBe(1)
    expect(storage.invalidationCalls).toBe(0)
    expect(storage.currentGeneration).toBe(4)
    expect(storage.snapshot()).toBeNull()
    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toBeUndefined()
    runtime.dispose()

    const reloaded = createRuntime(storage)
    await readyRuntime(reloaded)
    expect(storage.currentGeneration).toBe(4)
    expect(reloaded.queryCache.getQueryData(PUBLIC_KEY)).toBeUndefined()
    reloaded.dispose()
  })

  it('persists actual Pinia Colada garbage collection as a tombstoned deletion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    await runtime.activatePrivateQuery()

    await runtime.deactivatePrivateQuery()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(runtime.queryCache.get(CHARACTER_KEY)).toBeUndefined()
    expect(storage.snapshot()).toMatchObject({
      invalidationGeneration: 0,
      characters: {},
    })
    runtime.dispose()

    const reloaded = createRuntime(storage, undefined, Date.now)
    await readyRuntime(reloaded)
    await applyVerifiedQueryIdentity(reloaded.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    expect(reloaded.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    reloaded.dispose()
  })

  it('expires mounted public and private retained data after renewal without durable invalidation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const envelope = envelopeWithPrivatePartitions()
    setEnvelopeSuccessTime(envelope, NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS + 26_000)
    const storage = new MemoryQueryPersistenceStorage(envelope)
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    const loadAdmission = vi.fn().mockResolvedValue(admission())
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), loadAdmission)
    await runtime.activatePrivateQuery()
    const activeEntry = runtime.queryCache.get(CHARACTER_KEY)

    await vi.advanceTimersByTimeAsync(25_000)
    expect(loadAdmission).toHaveBeenCalledTimes(2)
    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public' })
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' })

    await vi.advanceTimersByTimeAsync(1_000)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    expect(runtime.queryCache.get(CHARACTER_KEY)).toBe(activeEntry)
    expect(activeEntry?.state.value).toEqual({ status: 'pending', data: undefined, error: null })
    expect(activeEntry?.asyncStatus.value).toBe('idle')
    expect(activeEntry?.when).toBe(0)
    expect(storage.currentGeneration).toBe(0)
    expect(storage.invalidationCalls).toBe(0)
    expect(storage.snapshot()).toMatchObject({ public: {}, characters: {}, organizations: {} })
    runtime.dispose()
  })

  it('refreshes enabled mounted queries when their retained data expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const envelope = envelopeWithPrivatePartitions()
    setEnvelopeSuccessTime(envelope, NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS + 1_000)
    const storage = new MemoryQueryPersistenceStorage(envelope)
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    await runtime.activatePrivateQuery()
    const publicQuery = vi.fn().mockResolvedValue({ name: 'Current public' })
    const privateQuery = vi.fn().mockResolvedValue({ name: 'Current private' })
    ensurePublicQuery(runtime.queryCache, publicQuery)
    ensurePrivateQuery(runtime.queryCache, privateQuery)

    await vi.advanceTimersByTimeAsync(1_000)

    expect(publicQuery).toHaveBeenCalledOnce()
    expect(privateQuery).toHaveBeenCalledOnce()
    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Current public' })
    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Current private' })
    runtime.dispose()
  })

  it('preserves a mounted query failure when its retained data expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const envelope = envelopeWithPrivatePartitions()
    setEnvelopeSuccessTime(envelope, NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS + 1_000)
    const runtime = createRuntime(new MemoryQueryPersistenceStorage(envelope), undefined, Date.now)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    await runtime.activatePrivateQuery()
    const failure = new ApiQueryError('ESI is unavailable.', { status: 503 })
    const entry = ensurePrivateQuery(runtime.queryCache, async () => {
      throw failure
    })
    await expect(runtime.queryCache.fetch(entry)).rejects.toBe(failure)

    await vi.advanceTimersByTimeAsync(1_000)

    expect(entry.state.value).toEqual({ status: 'error', data: undefined, error: failure })
    expect(entry.asyncStatus.value).toBe('idle')
    expect(entry.when).toBe(0)
    runtime.dispose()
  })

  it('schedules physical expiry after the first successful persisted write', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage()
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    await runtime.activatePrivateQuery()
    const entry = ensurePublicQuery(runtime.queryCache, async () => ({ name: 'Current' }))

    await runtime.queryCache.fetch(entry)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(storage.snapshot()?.public[JSON.stringify(PUBLIC_KEY)]).toBeDefined()

    await vi.advanceTimersByTimeAsync(PERSISTED_ESI_QUERY_CACHE_RETENTION_MS - 1_000)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Current' })
    expect(storage.snapshot()?.public).toEqual({})
    runtime.dispose()
  })

  it('quarantines retained private data while a resumed tab verifies durable generation', async () => {
    const storage = new DeferredResumeGenerationStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const entry = runtime.queryCache.get(CHARACTER_KEY)
    storage.deferNextGenerationRead()

    window.dispatchEvent(new Event('focus'))

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(
      readQueryPersistenceState(runtime.queryCache, CHARACTER_KEY).value.retainedPrivateAccess,
    ).toBe(false)

    storage.releaseGeneration()
    await vi.waitFor(() =>
      expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toEqual({ name: 'Character' }),
    )
    expect(runtime.queryCache.get(CHARACTER_KEY)).toBe(entry)
    runtime.dispose()
  })

  it('keeps a fresh current result when its prior retained representation expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const envelope = envelopeWithPrivatePartitions()
    envelope.public[JSON.stringify(PUBLIC_KEY)]![2] =
      NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS + 1_000
    const storage = new MemoryQueryPersistenceStorage(envelope)
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    await vi.advanceTimersByTimeAsync(500)
    const entry = ensurePublicQuery(runtime.queryCache, async () => ({ name: 'Fresh current' }))

    await runtime.queryCache.fetch(entry)
    await vi.advanceTimersByTimeAsync(500)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Fresh current' })
    expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toMatchObject({
      kind: 'fresh',
      originalSuccessAt: new Date(NOW + 500).toISOString(),
    })
    runtime.dispose()
  })

  it('clears the retained-data expiry timer on disposal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const envelope = envelopeWithPrivatePartitions()
    setEnvelopeSuccessTime(envelope, NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS + 1_000)
    const storage = new MemoryQueryPersistenceStorage(envelope)
    const runtime = createRuntime(storage, undefined, Date.now)
    await awaitQueryPersistenceRestoration(runtime.queryCache)
    const writesBeforeDisposal = storage.writeCalls

    runtime.dispose()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(storage.writeCalls).toBe(writesBeforeDisposal)
    expect(storage.snapshot()).not.toBeNull()
  })

  it('ignores admission completion after disposal', async () => {
    const storage = new MemoryQueryPersistenceStorage()
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    const loading = deferred<CacheAdmissionContext>()
    const applying = applyVerifiedQueryIdentity(
      runtime.queryCache,
      authenticatedSession(),
      () => loading.promise,
    )

    runtime.dispose()
    loading.resolve(admission())

    await expect(applying).resolves.toBe(false)
    expect(storage.generationReads).toBe(0)
    expect(storage.invalidationCalls).toBe(0)
    expect(notifications.published).toEqual([])
  })

  it('invalidates a second runtime through shared durable storage and notifications', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const notifications = new NotificationHub()
    const first = createRuntime(storage, notifications.createAdapter())
    const second = createRuntime(storage, notifications.createAdapter())
    await Promise.all([readyRuntime(first), readyRuntime(second)])
    await Promise.all([
      applyVerifiedQueryIdentity(first.queryCache, authenticatedSession(), async () => admission()),
      applyVerifiedQueryIdentity(second.queryCache, authenticatedSession(), async () =>
        admission(),
      ),
    ])
    expect(first.queryCache.getQueryData(CHARACTER_KEY)).toBeDefined()
    expect(second.queryCache.getQueryData(CHARACTER_KEY)).toBeDefined()

    await invalidatePrivateQueryScope(first.queryCache, { kind: 'character', characterId: 7 })

    expect(first.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(second.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(storage.snapshot()).toMatchObject({
      invalidationGeneration: 1,
      characters: {},
    })
    first.dispose()
    second.dispose()
  })

  it('purges protected non-persisted queries and consumer state from observed invalidations', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const organizationKey = PRIVATE_QUERY_KEYS.organizationContext()
    const recipientKey = PRIVATE_QUERY_KEYS.mailRecipientResolution(7, 'pilot')
    ensureNonPersistedQuery(runtime.queryCache, organizationKey)
    ensureNonPersistedQuery(runtime.queryCache, recipientKey)
    runtime.queryCache.setQueryData(organizationKey, { memberAccess: true })
    runtime.queryCache.setQueryData(recipientKey, { recipients: [{ id: 8 }] })
    const resetOrganizationState = vi.fn()
    subscribePrivateQueryInvalidation(
      runtime.queryCache,
      { kind: 'organization' },
      resetOrganizationState,
    )

    storage.setGeneration(1)
    notifications.emit({
      generation: 1,
      scope: { kind: 'organization', admissionScope: ORGANIZATION_SCOPE },
    })

    expect(runtime.queryCache.getQueryData(organizationKey)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(recipientKey)).toBeDefined()
    expect(runtime.queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(
      authenticatedSession(),
    )
    expect(resetOrganizationState).toHaveBeenCalledOnce()

    storage.setGeneration(2)
    notifications.emit({ generation: 2, scope: { kind: 'character', characterId: 7 } })
    expect(runtime.queryCache.getQueryData(recipientKey)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(
      authenticatedSession(),
    )

    storage.setGeneration(3)
    notifications.emit({ generation: 3, scope: { kind: 'all' } })
    expect(runtime.queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toBeUndefined()
    runtime.dispose()
  })

  it('cancels a protected non-persisted request before its late completion can restore data', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    const result = deferred<{ recipients: Array<{ id: number }> }>()
    const key = PRIVATE_QUERY_KEYS.mailRecipientResolution(7, 'pilot')
    const entry = ensureNonPersistedQuery(runtime.queryCache, key, () => result.promise)
    const fetching = runtime.queryCache.fetch(entry)
    await vi.waitFor(() => expect(entry.pending).not.toBeNull())

    storage.setGeneration(1)
    notifications.emit({ generation: 1, scope: { kind: 'character', characterId: 7 } })
    result.resolve({ recipients: [{ id: 8 }] })
    await fetching
    await nextTick()

    expect(entry.pending).toBeNull()
    expect(runtime.queryCache.getQueryData(key)).toBeUndefined()
    runtime.dispose()
  })

  it('purges the broad protected roster during character-specific invalidation', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )
    runtime.queryCache.setQueryData(PRIVATE_QUERY_KEYS.roster(), {
      characters: [{ characterId: 7 }, { characterId: 8 }],
    })

    storage.setGeneration(1)
    notifications.emit({ generation: 1, scope: { kind: 'character', characterId: 7 } })

    expect(runtime.queryCache.getQueryData(PRIVATE_QUERY_KEYS.roster())).toBeUndefined()
    runtime.dispose()
  })

  it('closes affected data before forcing admission and detects consequential scope changes', async () => {
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage)
    await readyRuntime(runtime)
    const nextAdmission = deferred<CacheAdmissionContext>()
    let admissionLoads = 0
    let deferAdmission = false
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), () => {
      admissionLoads += 1
      return deferAdmission ? nextAdmission.promise : Promise.resolve(admission())
    })
    deferAdmission = true
    const refreshing = refreshPrivateQueryAdmission(runtime.queryCache, {
      kind: 'character',
      characterId: 7,
    })

    expect(runtime.queryCache.getQueryData(CHARACTER_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeDefined()
    nextAdmission.resolve(
      admission({
        characterRevision: null,
        organizationRevision: 'organization-revision-2',
      }),
    )

    await expect(refreshing).resolves.toBe(true)
    expect(admissionLoads).toBe(2)
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    expect(runtime.queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(
      authenticatedSession(),
    )
    runtime.dispose()
  })

  it('purges all in-memory data when durable invalidation recovers a pending barrier', async () => {
    const storage = new RecoveringInvalidationStorage(envelopeWithPrivatePartitions())
    const notifications = new TestNotifications()
    const runtime = createRuntime(storage, notifications)
    await readyRuntime(runtime)
    await applyVerifiedQueryIdentity(runtime.queryCache, authenticatedSession(), async () =>
      admission(),
    )

    await expect(
      invalidatePrivateQueryScope(runtime.queryCache, { kind: 'character', characterId: 7 }),
    ).resolves.toBe(false)
    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeDefined()
    await expect(
      invalidatePrivateQueryScope(runtime.queryCache, {
        kind: 'organization',
        admissionScope: ORGANIZATION_SCOPE,
      }),
    ).resolves.toBe(true)

    expect(runtime.queryCache.getQueryData(ORGANIZATION_KEY)).toBeUndefined()
    expect(notifications.published).toEqual([
      { generation: null, scope: { kind: 'all' } },
      { generation: 1, scope: { kind: 'all' } },
    ])
    runtime.dispose()
  })

  it('preserves the original timestamp and latest metadata across repeated stale successes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage()
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    let result = staleResult(NOW - 60_000, {
      refreshFailureClass: 'esi-unavailable',
      retryAt: NOW + 5_000,
    })
    const entry = ensurePublicQuery(runtime.queryCache, async () => result)

    await runtime.queryCache.fetch(entry)
    const originalSuccessAt = NOW - 60_000
    vi.setSystemTime(NOW + 10_000)
    result = staleResult(NOW + 5_000, {
      refreshFailureClass: 'esi-cooldown',
      retryAt: NOW + 20_000,
    })
    await runtime.queryCache.fetch(entry)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toEqual({
      kind: 'server-stale',
      originalSuccessAt: new Date(originalSuccessAt).toISOString(),
      retainedPrivateAccess: false,
      validatedAt: new Date(NOW + 5_000).toISOString(),
      retryAt: new Date(NOW + 20_000).toISOString(),
      refreshFailureClass: 'esi-cooldown',
    })
    expect(storage.snapshot()?.public[JSON.stringify(PUBLIC_KEY)]?.[2]).toBe(originalSuccessAt)
    runtime.dispose()
  })

  it('preserves repeated stale data across reload, then expires it without resurrection', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const originalSuccessAt = NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS + 2_000
    const envelope = envelopeWithPrivatePartitions()
    envelope.public[JSON.stringify(PUBLIC_KEY)]![2] = originalSuccessAt
    const storage = new MemoryQueryPersistenceStorage(envelope)
    const first = createRuntime(storage, undefined, Date.now)
    await readyRuntime(first)
    const firstEntry = ensurePublicQuery(first.queryCache, async () =>
      staleResult(originalSuccessAt + 500, { refreshFailureClass: 'esi-unavailable' }),
    )

    await first.queryCache.fetch(firstEntry)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(storage.snapshot()?.public[JSON.stringify(PUBLIC_KEY)]?.[2]).toBe(originalSuccessAt)
    first.dispose()

    const second = createRuntime(storage, undefined, Date.now)
    await readyRuntime(second)
    expect(second.queryCache.getQueryData(PUBLIC_KEY)).toBeDefined()
    const secondEntry = ensurePublicQuery(second.queryCache, async () =>
      staleResult(originalSuccessAt + 1_000, { refreshFailureClass: 'esi-cooldown' }),
    )
    await second.queryCache.fetch(secondEntry)
    expect(readQueryPersistenceState(second.queryCache, PUBLIC_KEY).value).toMatchObject({
      kind: 'server-stale',
      originalSuccessAt: new Date(originalSuccessAt).toISOString(),
    })

    await vi.advanceTimersByTimeAsync(1_000)

    expect(second.queryCache.getQueryData(PUBLIC_KEY)).toBeUndefined()
    expect(storage.snapshot()?.public ?? {}).toEqual({})
    second.dispose()

    const third = createRuntime(storage, undefined, Date.now)
    await readyRuntime(third)
    expect(third.queryCache.getQueryData(PUBLIC_KEY)).toBeUndefined()
    third.dispose()
  })

  it('does not tombstone recovery invalidation or advance a failed refresh timestamp', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions())
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    const originalSuccessAt = storage.snapshot()?.public[JSON.stringify(PUBLIC_KEY)]?.[2]
    const error = new ApiQueryError('ESI unavailable.', { status: 503 })
    const entry = ensurePublicQuery(runtime.queryCache, async () => {
      throw error
    })
    const remove = vi.spyOn(runtime.queryCache, 'remove')

    runtime.queryCache.invalidate(entry)
    await expect(runtime.queryCache.fetch(entry)).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(remove).not.toHaveBeenCalled()
    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public' })
    expect(storage.snapshot()?.public[JSON.stringify(PUBLIC_KEY)]?.[2]).toBe(originalSuccessAt)
    runtime.dispose()
  })

  it('preserves a persisted retention timestamp for stale SSR data', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const envelope = envelopeWithPrivatePartitions()
    envelope.public[JSON.stringify(PUBLIC_KEY)]![2] = NOW - 2 * 60 * 60_000
    const storage = new MemoryQueryPersistenceStorage(envelope)
    const runtime = createRuntime(storage)
    await awaitQueryPersistenceRestoration(runtime.queryCache)
    const ssrData = staleResult(NOW - 60_000, { refreshFailureClass: 'esi-unavailable' })

    hydrateQueryCache(runtime.queryCache, {
      [JSON.stringify(PUBLIC_KEY)]: [ssrData, null, 0, { esiPersistence: { kind: 'public-esi' } }],
    })
    signalNuxtHydrationFinished(runtime.queryCache)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual(ssrData)
    expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toMatchObject({
      kind: 'server-stale',
      originalSuccessAt: new Date(NOW - 2 * 60 * 60_000).toISOString(),
      validatedAt: new Date(NOW - 60_000).toISOString(),
    })
    expect(storage.snapshot()?.public[JSON.stringify(PUBLIC_KEY)]?.[0]).toEqual(ssrData)
    runtime.dispose()
  })

  it('does not use the SSR hydration timestamp for stale data without an original time', async () => {
    const storage = new MemoryQueryPersistenceStorage()
    const runtime = createRuntime(storage)
    await awaitQueryPersistenceRestoration(runtime.queryCache)
    const ssrData = staleResult()

    hydrateQueryCache(runtime.queryCache, {
      [JSON.stringify(PUBLIC_KEY)]: [ssrData, null, 0, { esiPersistence: { kind: 'public-esi' } }],
    })
    signalNuxtHydrationFinished(runtime.queryCache)

    expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toMatchObject({
      kind: 'server-stale',
      originalSuccessAt: undefined,
    })
    runtime.dispose()
  })

  it.each([
    ['valid', NOW - 60_000, NOW - 60_000, true],
    ['missing', undefined, undefined, false],
    ['future', NOW + 1, undefined, false],
  ] as const)(
    'handles a first stale success with a %s authoritative timestamp',
    async (_label, validatedAt, expectedOriginal, persisted) => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const storage = new MemoryQueryPersistenceStorage()
      const runtime = createRuntime(storage, undefined, Date.now)
      await readyRuntime(runtime)
      const result = staleResult(validatedAt)
      const entry = ensurePublicQuery(runtime.queryCache, async () => result)

      await runtime.queryCache.fetch(entry)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toMatchObject({
        kind: 'server-stale',
        originalSuccessAt:
          expectedOriginal === undefined ? undefined : new Date(expectedOriginal).toISOString(),
      })
      expect(Object.hasOwn(storage.snapshot()?.public ?? {}, JSON.stringify(PUBLIC_KEY))).toBe(
        persisted,
      )
      runtime.dispose()
    },
  )

  it('rejects an expired stale success without starting a refetch loop', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage()
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    await runtime.activatePrivateQuery()
    const query = vi
      .fn()
      .mockResolvedValue(staleResult(NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS))
    const entry = ensurePublicQuery(runtime.queryCache, query)

    await runtime.queryCache.fetch(entry)

    expect(query).toHaveBeenCalledOnce()
    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toBeUndefined()
    expect(entry.state.value).toMatchObject({
      status: 'error',
      data: undefined,
      error: {
        code: 'ESI_UNAVAILABLE',
        message: 'Previously cached data expired before current ESI data became available.',
        status: 502,
      },
    })
    expect(storage.snapshot()?.public ?? {}).toEqual({})
    expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toEqual({
      kind: 'fresh',
      retainedPrivateAccess: false,
    })
    runtime.dispose()
  })

  it('preserves restored data and provenance after failure, then resets both on fresh recovery', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const runtime = createRuntime(
      new MemoryQueryPersistenceStorage(envelopeWithPrivatePartitions()),
      undefined,
      Date.now,
    )
    await readyRuntime(runtime)
    let failure: Error | undefined = new ApiQueryError('ESI unavailable.', {
      status: 503,
      retryAt: new Date(NOW + 10_000).toISOString(),
    })
    const entry = ensurePublicQuery(runtime.queryCache, async () => {
      if (failure) throw failure
      return { name: 'Fresh' }
    })

    await expect(runtime.queryCache.fetch(entry)).rejects.toThrow('ESI unavailable.')

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Public' })
    expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toEqual({
      kind: 'restored-refresh-failed',
      originalSuccessAt: new Date(NOW - 60_000).toISOString(),
      retainedPrivateAccess: false,
      retryAt: new Date(NOW + 10_000).toISOString(),
      refreshFailureStatus: 503,
    })

    vi.setSystemTime(NOW + 20_000)
    failure = undefined
    await runtime.queryCache.fetch(entry)

    expect(runtime.queryCache.getQueryData(PUBLIC_KEY)).toEqual({ name: 'Fresh' })
    expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toEqual({
      kind: 'fresh',
      originalSuccessAt: new Date(NOW + 20_000).toISOString(),
      retainedPrivateAccess: false,
    })
    runtime.dispose()
  })

  it('does not invent an original success timestamp for local query data', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new MemoryQueryPersistenceStorage()
    const runtime = createRuntime(storage, undefined, Date.now)
    await readyRuntime(runtime)
    ensurePublicQuery(runtime.queryCache, async () => ({ name: 'Fetched' }))

    runtime.queryCache.setQueryData(PUBLIC_KEY, { name: 'Local' })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(readQueryPersistenceState(runtime.queryCache, PUBLIC_KEY).value).toMatchObject({
      kind: 'fresh',
      originalSuccessAt: undefined,
    })
    expect(storage.snapshot()?.public).toEqual({})
    runtime.dispose()
  })
})

function createRuntime(
  storage: QueryPersistenceStorage,
  notifications = new NotificationHub().createAdapter(),
  now: () => number = () => NOW,
  mountImmediately = true,
  mountedPrivateQuery?: () => Promise<unknown>,
) {
  const pinia = createPinia()
  const active = ref(false)
  const Consumer = {
    setup() {
      useQuery({
        enabled: false,
        gcTime: 1_000,
        key: CHARACTER_KEY,
        query: async () => ({ name: 'Live' }),
        meta: { esiPersistence: { kind: 'character-esi', characterId: 7 } },
      })
      useQuery({
        enabled: false,
        gcTime: 1_000,
        key: PUBLIC_KEY,
        query: async () => ({ name: 'Live public' }),
        meta: { esiPersistence: { kind: 'public-esi' } },
      })
      if (mountedPrivateQuery) {
        useQuery({
          gcTime: 1_000,
          key: CHARACTER_SIBLING_KEY,
          query: mountedPrivateQuery,
          staleTime: 0,
          meta: { esiPersistence: { kind: 'character-esi', characterId: 7 } },
        })
      }
      return () => null
    },
  }
  const app = createApp({
    setup: () => () => (active.value ? h(Consumer) : null),
  })
  app.use(pinia)
  app.use(PiniaColada, {
    plugins: [
      PiniaColadaRetry({ retry: 0 }),
      installQueryPersistence({ notifications, now, storage }),
    ],
  })
  let mounted = false
  const mount = () => {
    if (mounted) return
    mounted = true
    app.mount(document.createElement('div'))
  }
  if (mountImmediately) mount()
  const queryCache = useQueryCache(pinia)
  return {
    activatePrivateQuery: async () => {
      active.value = true
      await nextTick()
    },
    deactivatePrivateQuery: async () => {
      active.value = false
      await nextTick()
    },
    dispose: () => {
      app.unmount()
      disposePinia(pinia)
    },
    mount,
    queryCache,
  }
}

async function readyRuntime(runtime: { queryCache: QueryCache }) {
  await awaitQueryPersistenceRestoration(runtime.queryCache)
  signalNuxtHydrationFinished(runtime.queryCache)
}

class MemoryQueryPersistenceStorage implements QueryPersistenceStorage {
  readonly available = true
  generationReads = 0
  invalidationCalls = 0
  removeCalls = 0
  writeCalls = 0
  readonly privateWritePermissions: boolean[] = []
  protected generation: number
  protected value: string | null

  constructor(envelope: EsiQueryCacheEnvelope | null = null) {
    this.generation = envelope?.invalidationGeneration ?? 0
    this.value = envelope ? JSON.stringify(envelope) : null
  }

  async invalidate(scope: PrivateQueryInvalidationScope, deleteEnvelope = false) {
    this.invalidationCalls += 1
    return this.commitInvalidation(scope, deleteEnvelope)
  }

  protected commitInvalidation(scope: PrivateQueryInvalidationScope, deleteEnvelope = false) {
    const currentGeneration = this.generation
    this.generation += 1
    if (deleteEnvelope) {
      this.value = null
    } else if (this.value !== null) {
      const envelope = JSON.parse(this.value) as EsiQueryCacheEnvelope
      if (envelope.invalidationGeneration !== currentGeneration) {
        clearRecord(envelope.characters)
        clearRecord(envelope.organizations)
      } else {
        removePartitions(envelope, scope)
      }
      this.value = JSON.stringify({ ...envelope, invalidationGeneration: this.generation })
    }
    return { generation: this.generation, scope }
  }

  async read() {
    return { generation: this.generation, value: this.value }
  }

  async readGeneration() {
    this.generationReads += 1
    return this.generation
  }

  async removeEnvelope() {
    this.removeCalls += 1
    this.value = null
  }

  async write(value: string, allowPrivateWrite: boolean): Promise<QueryPersistenceStorageWrite> {
    this.writeCalls += 1
    this.privateWritePermissions.push(allowPrivateWrite)
    return this.commitWrite(value, allowPrivateWrite)
  }

  protected commitWrite(value: string, allowPrivateWrite: boolean): QueryPersistenceStorageWrite {
    const candidate = JSON.parse(value) as EsiQueryCacheEnvelope
    const privateAccepted =
      allowPrivateWrite && candidate.invalidationGeneration === this.generation
    if (privateAccepted) {
      this.value = value
    } else {
      const current = this.snapshot() ?? emptyEnvelope(this.generation)
      this.value = JSON.stringify({
        ...current,
        invalidationGeneration: this.generation,
        public: candidate.public,
      })
    }
    return { generation: this.generation, privateAccepted }
  }

  snapshot() {
    return this.value === null ? null : (JSON.parse(this.value) as EsiQueryCacheEnvelope)
  }

  get currentGeneration() {
    return this.generation
  }

  setGeneration(generation: number) {
    this.generation = generation
  }

  setRaw(value: string | null) {
    this.value = value
  }
}

class DeferredReadStorage extends MemoryQueryPersistenceStorage {
  private readonly readReady: Promise<void>
  readonly releaseRead: () => void

  constructor(envelope: EsiQueryCacheEnvelope) {
    super(envelope)
    let release!: () => void
    this.readReady = new Promise((resolve) => {
      release = resolve
    })
    this.releaseRead = release
  }

  override async read() {
    await this.readReady
    return super.read()
  }
}

class DeferredGenerationStorage extends MemoryQueryPersistenceStorage {
  private readonly generationResult = deferred<number | null>()

  override async readGeneration() {
    this.generationReads += 1
    return this.generationResult.promise
  }

  releaseGeneration(generation: number | null) {
    this.generationResult.resolve(generation)
  }
}

class DeferredResumeGenerationStorage extends MemoryQueryPersistenceStorage {
  private generationResult: ReturnType<typeof deferred<number>> | undefined

  deferNextGenerationRead() {
    this.generationResult = deferred<number>()
  }

  override async readGeneration() {
    this.generationReads += 1
    return this.generationResult?.promise ?? this.generation
  }

  releaseGeneration() {
    this.generationResult?.resolve(this.generation)
    this.generationResult = undefined
  }
}

class FailingGenerationStorage extends MemoryQueryPersistenceStorage {
  private failing = false

  failGenerationReads() {
    this.failing = true
  }

  override async readGeneration(): Promise<number | null> {
    this.generationReads += 1
    return this.failing ? null : this.generation
  }
}

class DeferredInvalidationStorage extends MemoryQueryPersistenceStorage {
  private readonly firstInvalidation = deferred<{
    generation: number
    scope: PrivateQueryInvalidationScope
  } | null>()
  private firstDeleteEnvelope = false
  private firstScope: PrivateQueryInvalidationScope = { kind: 'all' }

  override async invalidate(scope: PrivateQueryInvalidationScope, deleteEnvelope = false) {
    this.invalidationCalls += 1
    if (this.invalidationCalls === 1) {
      this.firstScope = scope
      this.firstDeleteEnvelope = deleteEnvelope
      return this.firstInvalidation.promise
    }
    if (this.generation === 0) this.generation = 1
    return this.commitInvalidation(scope, deleteEnvelope)
  }

  releaseFirstInvalidation() {
    if (this.generation === 0) {
      this.firstInvalidation.resolve(
        this.commitInvalidation(this.firstScope, this.firstDeleteEnvelope),
      )
      return
    }
    this.firstInvalidation.resolve({ generation: 1, scope: this.firstScope })
  }
}

class FailingInvalidationStorage extends MemoryQueryPersistenceStorage {
  override async invalidate() {
    this.invalidationCalls += 1
    return null
  }
}

class RecoveringInvalidationStorage extends MemoryQueryPersistenceStorage {
  override async invalidate(_scope: PrivateQueryInvalidationScope, deleteEnvelope = false) {
    this.invalidationCalls += 1
    if (this.invalidationCalls === 1) return null
    return this.commitInvalidation({ kind: 'all' }, deleteEnvelope)
  }
}

class MismatchedRestorationStorage extends MemoryQueryPersistenceStorage {
  constructor(envelope: EsiQueryCacheEnvelope) {
    super(envelope)
    this.generation = envelope.invalidationGeneration + 1
  }
}

class GenerationGapWriteStorage extends MemoryQueryPersistenceStorage {
  private gapEnabled = false

  enableGap() {
    this.gapEnabled = true
  }

  override async write(value: string, allowPrivateWrite: boolean) {
    if (!this.gapEnabled) return super.write(value, allowPrivateWrite)
    this.privateWritePermissions.push(allowPrivateWrite)
    this.generation += 2
    return { generation: this.generation, privateAccepted: false }
  }
}

class RejectingPrivateWriteStorage extends MemoryQueryPersistenceStorage {
  private nextFailure: 'quota' | 'rejected' | null = null

  rejectNextPrivateWrite(failure: 'quota' | 'rejected') {
    this.nextFailure = failure
  }

  override async write(value: string, allowPrivateWrite: boolean) {
    if (!allowPrivateWrite || this.nextFailure === null) {
      return super.write(value, allowPrivateWrite)
    }
    this.writeCalls += 1
    this.privateWritePermissions.push(allowPrivateWrite)
    const failure = this.nextFailure
    this.nextFailure = null
    if (failure === 'quota') throw new DOMException('Storage quota exceeded.', 'QuotaExceededError')
    this.commitWrite(value, false)
    return { generation: this.generation, privateAccepted: false }
  }
}

const unavailableStorage: QueryPersistenceStorage = {
  available: false,
  invalidate: async () => null,
  read: async () => ({ generation: null, value: null }),
  readGeneration: async () => null,
  removeEnvelope: async () => undefined,
  write: async () => ({ generation: null, privateAccepted: false }),
}

class NotificationHub {
  private readonly clients = new Set<Set<(notification: QueryPersistenceNotification) => void>>()

  createAdapter(): QueryPersistenceNotifications {
    const subscribers = new Set<(notification: QueryPersistenceNotification) => void>()
    this.clients.add(subscribers)
    return {
      dispose: () => this.clients.delete(subscribers),
      publish: (notification) => {
        for (const client of this.clients) {
          if (client === subscribers) continue
          for (const receive of client) receive(notification)
        }
      },
      subscribe: (receive) => {
        subscribers.add(receive)
        return () => subscribers.delete(receive)
      },
    }
  }
}

class TestNotifications implements QueryPersistenceNotifications {
  readonly published: QueryPersistenceNotification[] = []
  private readonly subscribers = new Set<(notification: QueryPersistenceNotification) => void>()

  dispose() {
    this.subscribers.clear()
  }

  emit(notification: QueryPersistenceNotification) {
    for (const receive of this.subscribers) receive(notification)
  }

  publish(notification: QueryPersistenceNotification) {
    this.published.push(notification)
  }

  subscribe(receive: (notification: QueryPersistenceNotification) => void) {
    this.subscribers.add(receive)
    return () => this.subscribers.delete(receive)
  }
}

function removePartitions(envelope: EsiQueryCacheEnvelope, scope: PrivateQueryInvalidationScope) {
  if (scope.kind === 'all') {
    clearRecord(envelope.characters)
    clearRecord(envelope.organizations)
  } else if (scope.kind === 'character') {
    if (scope.characterId === undefined) clearRecord(envelope.characters)
    else delete envelope.characters[String(scope.characterId)]
  } else if (scope.admissionScope === undefined) {
    clearRecord(envelope.organizations)
  } else {
    delete envelope.organizations[scope.admissionScope]
  }
}

function clearRecord(record: Record<string, unknown>) {
  for (const key of Object.keys(record)) delete record[key]
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, reject, resolve }
}

function envelopeWithPrivatePartitions(): EsiQueryCacheEnvelope {
  return {
    version: 1,
    invalidationGeneration: 0,
    public: {
      [JSON.stringify(PUBLIC_KEY)]: tuple({ name: 'Public' }, NOW - 60_000, {
        kind: 'public-esi',
      }),
    },
    characters: {
      7: {
        ownerUserId: 'user-1',
        admissionRevision: 'character-revision-1',
        cache: {
          [JSON.stringify(CHARACTER_KEY)]: tuple({ name: 'Character' }, NOW - 60_000, {
            kind: 'character-esi',
            characterId: 7,
          }),
        },
      },
    },
    organizations: {
      [ORGANIZATION_SCOPE]: {
        ownerUserId: 'user-1',
        organizationVersion: 3,
        admissionRevision: 'organization-revision-1',
        validUntil: null,
        cache: {
          [JSON.stringify(ORGANIZATION_KEY)]: tuple({ name: 'Organization' }, NOW - 60_000, {
            kind: 'organization-esi',
            admissionScope: ORGANIZATION_SCOPE,
          }),
        },
      },
    },
  }
}

function setEnvelopeSuccessTime(envelope: EsiQueryCacheEnvelope, when: number) {
  for (const entryTuple of Object.values(envelope.public)) entryTuple[2] = when
  for (const partition of Object.values(envelope.characters)) {
    for (const entryTuple of Object.values(partition.cache)) entryTuple[2] = when
  }
  for (const partition of Object.values(envelope.organizations)) {
    for (const entryTuple of Object.values(partition.cache)) entryTuple[2] = when
  }
}

function ensurePublicQuery(queryCache: QueryCache, query: () => Promise<unknown>) {
  return queryCache.ensure({
    key: PUBLIC_KEY,
    query,
    staleTime: 0,
    meta: { esiPersistence: { kind: 'public-esi' } },
  })
}

function ensurePrivateQuery(queryCache: QueryCache, query: () => Promise<unknown>) {
  return queryCache.ensure({
    key: CHARACTER_KEY,
    query,
    staleTime: 0,
    meta: { esiPersistence: { kind: 'character-esi', characterId: 7 } },
  })
}

function ensureOrganizationQuery(queryCache: QueryCache, query: () => Promise<unknown>) {
  return queryCache.ensure({
    key: ORGANIZATION_KEY,
    query,
    staleTime: 0,
    meta: {
      esiPersistence: { kind: 'organization-esi', admissionScope: ORGANIZATION_SCOPE },
    },
  })
}

function ensureNonPersistedQuery(
  queryCache: QueryCache,
  key: EntryKey,
  query: () => Promise<unknown> = async () => undefined,
) {
  return queryCache.ensure({
    key,
    query,
    staleTime: 0,
    meta: { esiPersistence: { kind: 'none' } },
  })
}

function staleResult(
  validatedAt?: number,
  metadata: {
    readonly refreshFailureClass?: string
    readonly retryAt?: number
  } = {},
) {
  return {
    name: 'Stale',
    stale: true as const,
    ...(validatedAt === undefined ? {} : { validatedAt: new Date(validatedAt).toISOString() }),
    ...(metadata.retryAt === undefined
      ? {}
      : { retryAt: new Date(metadata.retryAt).toISOString() }),
    ...(metadata.refreshFailureClass ? { refreshFailureClass: metadata.refreshFailureClass } : {}),
  }
}

function emptyEnvelope(generation: number): EsiQueryCacheEnvelope {
  return {
    version: 1,
    invalidationGeneration: generation,
    public: {},
    characters: {},
    organizations: {},
  }
}

function tuple(
  data: unknown,
  when: number,
  esiPersistence:
    | { readonly kind: 'public-esi' }
    | { readonly kind: 'character-esi'; readonly characterId: number }
    | { readonly kind: 'organization-esi'; readonly admissionScope: string },
): PersistedQueryTuple {
  return [data, null, when, { esiPersistence }]
}

function authenticatedSession(userId = 'user-1') {
  return {
    authenticated: true as const,
    account: {
      userId,
      mainCharacter: { characterId: 7, name: 'Test Pilot' },
    },
  }
}

function admission(
  overrides: {
    readonly admissionScopes?: readonly string[]
    readonly characterRevision?: string | null
    readonly organization?: null
    readonly organizationRevision?: string
    readonly organizationValidUntil?: string | null
    readonly organizationVersion?: number
    readonly userId?: string
  } = {},
): CacheAdmissionContext {
  return {
    userId: overrides.userId ?? 'user-1',
    characters: [
      {
        characterId: 7,
        admissionRevision:
          overrides.characterRevision === undefined
            ? 'character-revision-1'
            : overrides.characterRevision,
      },
    ],
    organization:
      overrides.organization === null
        ? null
        : {
            organizationVersion: overrides.organizationVersion ?? 3,
            admissionRevision: overrides.organizationRevision ?? 'organization-revision-1',
            validUntil: overrides.organizationValidUntil ?? null,
            admissionScopes: overrides.admissionScopes ?? [ORGANIZATION_SCOPE],
          },
  }
}

function authorizationDenial(code: string) {
  return new ApiQueryError('Denied.', { status: 403, code })
}

function characterPrefetch(query: () => Promise<unknown>) {
  return {
    key: CHARACTER_KEY,
    query,
    meta: { esiPersistence: { kind: 'character-esi' as const, characterId: 7 } },
  }
}
