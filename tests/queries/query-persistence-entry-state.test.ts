import { describe, expect, it } from 'vitest'
import { createQueryPersistenceEntryState } from '../../app/query-persistence/entry-state'
import {
  serializePersistedEnvelope,
  type EsiQueryCacheEnvelope,
  type PersistedQueryTuple,
} from '../../app/query-persistence/envelope'
import { ApiQueryError } from '../../app/utils/query-error'

const NOW = Date.parse('2026-09-14T11:00:00.000Z')
const KEY = ['public', 'characters', 7] as const
const KEY_HASH = JSON.stringify(KEY)

describe('query persistence entry state', () => {
  it('keeps an original timestamp across stale successes and resets on fresh recovery', () => {
    const state = createQueryPersistenceEntryState()
    const originalSuccessAt = NOW - 60_000

    state.succeeded({
      data: staleResult(originalSuccessAt, 'esi-unavailable'),
      keyHash: KEY_HASH,
      now: NOW,
      source: 'fetch',
      when: NOW,
    })
    state.succeeded({
      data: staleResult(NOW + 5000, 'esi-cooldown'),
      keyHash: KEY_HASH,
      now: NOW + 10_000,
      source: 'fetch',
      when: NOW + 10_000,
    })

    expect(state.readPresentation(KEY_HASH)).toStrictEqual({
      kind: 'server-stale',
      originalSuccessAt: new Date(originalSuccessAt).toISOString(),
      refreshFailureClass: 'esi-cooldown',
      validatedAt: new Date(NOW + 5000).toISOString(),
    })

    state.succeeded({
      data: { name: 'Fresh' },
      keyHash: KEY_HASH,
      now: NOW + 20_000,
      source: 'fetch',
      when: NOW + 20_000,
    })

    expect(state.readPresentation(KEY_HASH)).toStrictEqual({
      kind: 'fresh',
      originalSuccessAt: new Date(NOW + 20_000).toISOString(),
    })
    expect(state.hasRestoredData(KEY_HASH)).toBe(false)
    expect(state.hasFailedData(KEY_HASH)).toBe(false)
  })

  it('preserves restored provenance through failure without changing its timestamp', () => {
    const state = createQueryPersistenceEntryState()
    const originalSuccessAt = NOW - 60_000
    state.restored(KEY_HASH, { name: 'Restored' }, originalSuccessAt)

    state.failed(
      KEY_HASH,
      new ApiQueryError('ESI unavailable.', {
        code: 'ESI_UNAVAILABLE',
        retryAt: new Date(NOW + 10_000).toISOString(),
        status: 503,
      }),
      true,
    )

    expect(state.readPresentation(KEY_HASH)).toStrictEqual({
      kind: 'restored-refresh-failed',
      originalSuccessAt: new Date(originalSuccessAt).toISOString(),
      refreshFailureCode: 'ESI_UNAVAILABLE',
      refreshFailureStatus: 503,
      retryAt: new Date(NOW + 10_000).toISOString(),
    })
    expect(state.hasRestoredData(KEY_HASH)).toBe(true)
    expect(state.hasFailedData(KEY_HASH)).toBe(true)
  })

  it('does not invent an original timestamp for a local write', () => {
    const state = createQueryPersistenceEntryState()

    state.localWrite({ keyHash: KEY_HASH, now: NOW })

    expect(state.readPresentation(KEY_HASH)).toStrictEqual({
      kind: 'fresh',
      originalSuccessAt: undefined,
    })
    expect(state.readOriginalSuccessTime(KEY_HASH)).toBeUndefined()
    expect(state.hasFailedData(KEY_HASH)).toBe(false)
  })

  it('does not report a transition when an ensured success is already classified', () => {
    const state = createQueryPersistenceEntryState()

    expect(
      state.succeeded({
        data: { name: 'SSR result' },
        keyHash: KEY_HASH,
        now: NOW,
        source: 'ssr',
        when: NOW,
      }),
    ).toBe(true)
    expect(
      state.succeeded({
        data: { name: 'SSR result' },
        keyHash: KEY_HASH,
        now: NOW,
        source: 'ssr',
        when: NOW,
      }),
    ).toBe(false)
  })

  it('keeps removals tombstoned through serializer merge so prior tuples cannot resurrect', () => {
    const state = createQueryPersistenceEntryState()
    const priorEnvelope = emptyEnvelope()
    priorEnvelope.public[KEY_HASH] = tuple({ name: 'Prior' }, NOW - 60_000)
    state.restored(KEY_HASH, { name: 'Prior' }, NOW - 60_000)
    state.removed(KEY_HASH)

    const result = serializePersistedEnvelope(
      {},
      {
        admission: null,
        durableGenerationVerified: true,
        generation: 0,
        hasFailedData: (keyHash) => state.hasFailedData(keyHash),
        hasQuarantinedData: (keyHash) => state.hasQuarantinedData(keyHash),
        isRemovalTombstoned: (keyHash) => state.isRemovalTombstoned(keyHash),
        now: NOW,
        priorEnvelope,
        privatePersistenceEnabled: true,
        readOriginalSuccessTime: (keyHash) => state.readOriginalSuccessTime(keyHash),
        retainedPrivateAccessOpen: false,
        verifiedUserId: null,
      },
    )
    state.serializerMerged(result.acceptedSuccessfulTimes)

    expect(Object.keys(result.envelope.public)).toStrictEqual([])
    expect(state.isRemovalTombstoned(KEY_HASH)).toBe(true)
    expect(state.readPresentation(KEY_HASH)).toStrictEqual({ kind: 'fresh' })

    state.serializerMerged(new Map([[KEY_HASH, NOW]]))
    expect(state.isRemovalTombstoned(KEY_HASH)).toBe(false)
    expect(state.readOriginalSuccessTime(KEY_HASH)).toBe(NOW)
  })
})

function staleResult(validatedAt: number, refreshFailureClass: string) {
  return {
    refreshFailureClass,
    stale: true,
    validatedAt: new Date(validatedAt).toISOString(),
  }
}

function emptyEnvelope(): EsiQueryCacheEnvelope {
  return {
    characters: {},
    invalidationGeneration: 0,
    organizations: {},
    public: {},
    version: 1,
  }
}

function tuple(data: unknown, when: number): PersistedQueryTuple {
  return [data, null, when, { esiPersistence: { kind: 'public-esi' } }]
}
