import type { EntryKey, QueryCache, UseQueryEntry } from '@pinia/colada'
import { describe, expect, it, vi } from 'vitest'
import { createEveImages } from '../src/runtime/eve-images.js'
import {
  canRunPlatformProtectedQuery,
  clearAuthenticatedQueriesAfterSessionTransition,
  removePlatformModuleQueries,
  removePlatformModuleSectionQueries,
  removePlatformQuery,
  removePlatformQueryScope,
} from '../src/runtime/query-lifecycle.js'
import { platformModuleQueryKey } from '../src/runtime/query-keys.js'
import {
  ApiQueryError,
  reduceApiQueryError,
  reviveApiQueryError,
  toApiQueryError,
} from '../src/runtime/query-error.js'
import { selectEsiQueryPersistencePresentation } from '../src/runtime/query-persistence-presentation.js'

describe('platform module runtime surface', () => {
  it('selects the most actionable active persistence presentation', () => {
    expect(
      selectEsiQueryPersistencePresentation([
        { kind: 'fresh' },
        { kind: 'restored', originalSuccessAt: '2026-09-15T01:00:00.000Z' },
        {
          kind: 'restored-refresh-failed',
          originalSuccessAt: '2026-09-15T01:00:00.000Z',
          refreshFailureStatus: 503,
        },
        {
          kind: 'server-stale',
          refreshFailureClass: 'esi-cooldown',
          validatedAt: '2026-09-15T01:02:00.000Z',
        },
      ]),
    ).toMatchObject({ kind: 'restored-refresh-failed', refreshFailureStatus: 503 })
    expect(selectEsiQueryPersistencePresentation([])).toStrictEqual({ kind: 'fresh' })
  })

  it('binds module queries to authoritative private subjects', () => {
    expect(
      platformModuleQueryKey('activity', { characterId: 7, kind: 'character' }, ['feed']),
    ).toStrictEqual(['private', 'characters', 7, 'modules', 'activity', 'feed'])
    expect(
      platformModuleQueryKey(
        'activity',
        { corporationId: 99, kind: 'corporation', organizationVersion: 3 },
        ['feed'],
      ),
    ).toStrictEqual([
      'private',
      'organization',
      3,
      'corporations',
      99,
      'modules',
      'activity',
      'feed',
    ])
  })

  it('requires client authentication and subject authorization', () => {
    expect(
      canRunPlatformProtectedQuery({
        authenticated: true,
        isClient: true,
        moduleEnabled: true,
        subject: { kind: 'organization', organizationVersion: 3 },
      }),
    ).toBe(false)
    expect(
      canRunPlatformProtectedQuery({
        authenticated: true,
        authorized: true,
        isClient: true,
        moduleEnabled: true,
        subject: { kind: 'organization', organizationVersion: 3 },
      }),
    ).toBe(true)
    expect(
      canRunPlatformProtectedQuery({
        authenticated: true,
        isClient: false,
        moduleEnabled: true,
        ownsCharacter: true,
        subject: { characterId: 7, kind: 'character' },
      }),
    ).toBe(false)
    expect(
      canRunPlatformProtectedQuery({
        authenticated: true,
        isClient: true,
        moduleEnabled: true,
        ownsCharacter: true,
        subject: { characterId: Number.NaN, kind: 'character' },
      }),
    ).toBe(false)
  })

  it('distinguishes exact query removal from prefix scope removal', () => {
    const rootEntry = queryEntry(['private', 'characters', 7])
    const childEntry = queryEntry(['private', 'characters', 7, 'modules', 'activity'])
    const queryCache = {
      cancelQueries: vi.fn(),
      getEntries: vi.fn(({ exact }: { exact?: boolean }) =>
        exact ? [rootEntry] : [rootEntry, childEntry],
      ),
      remove: vi.fn(),
    } as unknown as QueryCache

    removePlatformQuery(queryCache, rootEntry.key)

    expect(queryCache.getEntries).toHaveBeenLastCalledWith({ exact: true, key: rootEntry.key })
    expect(queryCache.remove).toHaveBeenCalledWith(rootEntry)
    expect(queryCache.remove).not.toHaveBeenCalledWith(childEntry)

    removePlatformQueryScope(queryCache, rootEntry.key)

    expect(queryCache.getEntries).toHaveBeenLastCalledWith({ key: rootEntry.key })
    expect(queryCache.remove).toHaveBeenCalledWith(childEntry)
  })

  it('cancels and removes only the disabled module entries', () => {
    const activityEntry = queryEntry(['private', 'organization', 3, 'modules', 'activity', 'feed'])
    const otherEntry = queryEntry(['private', 'characters', 7, 'modules', 'mail', 'headers'])
    const queryCache = {
      cancel: vi.fn(),
      getEntries: vi.fn(() => [activityEntry, otherEntry]),
      remove: vi.fn(),
    } as unknown as QueryCache

    removePlatformModuleQueries(queryCache, 'activity')

    expect(queryCache.cancel).toHaveBeenCalledOnce()
    expect(queryCache.remove).toHaveBeenCalledWith(activityEntry)
    expect(queryCache.remove).not.toHaveBeenCalledWith(otherEntry)
  })

  it('cancels and removes account queries for only the disabled module section', () => {
    const skillsEntry = queryEntry(
      platformModuleQueryKey('member-audit', { kind: 'account' }, ['summary'], 'skills'),
    )
    const assetsEntry = queryEntry(
      platformModuleQueryKey('member-audit', { kind: 'account' }, ['summary'], 'assets'),
    )
    const unrelatedEntry = queryEntry(
      platformModuleQueryKey('member-audit', { characterId: 7, kind: 'character' }, [
        'account',
        'sections',
        'skills',
      ]),
    )
    const queryCache = {
      cancel: vi.fn(),
      getEntries: vi.fn(() => [skillsEntry, assetsEntry, unrelatedEntry]),
      remove: vi.fn(),
    } as unknown as QueryCache

    removePlatformModuleSectionQueries(queryCache, 'member-audit', 'skills')

    expect(queryCache.cancel).toHaveBeenCalledOnce()
    expect(queryCache.cancel).toHaveBeenCalledWith(skillsEntry, expect.any(Error))
    expect(queryCache.remove).toHaveBeenCalledWith(skillsEntry)
    expect(queryCache.remove).not.toHaveBeenCalledWith(assetsEntry)
    expect(queryCache.remove).not.toHaveBeenCalledWith(unrelatedEntry)
  })

  it('retains a settled anonymous session while clearing private descendants', () => {
    const sessionEntry = queryEntry(['private', 'session'])
    const childEntry = queryEntry(['private', 'characters', 7, 'assets'])
    const queryCache = {
      cancelQueries: vi.fn(),
      get: vi.fn(() => sessionEntry),
      getEntries: vi.fn(() => [sessionEntry, childEntry]),
      remove: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryCache

    clearAuthenticatedQueriesAfterSessionTransition(queryCache, { authenticated: false })

    expect(queryCache.cancelQueries).toHaveBeenCalledWith(
      { exact: true, key: childEntry.key },
      expect.any(Error),
    )
    expect(queryCache.cancelQueries).not.toHaveBeenCalledWith(
      { exact: true, key: sessionEntry.key },
      expect.anything(),
    )
    expect(queryCache.remove).toHaveBeenCalledWith(childEntry)
    expect(queryCache.remove).not.toHaveBeenCalledWith(sessionEntry)
    expect(queryCache.setQueryData).toHaveBeenCalledWith(['private', 'session'], {
      authenticated: false,
    })
  })

  it('retains a newly authenticated session while clearing prior private descendants', () => {
    const sessionEntry = queryEntry(['private', 'session'])
    const childEntry = queryEntry(['private', 'organization', 'roles'])
    const queryCache = {
      cancelQueries: vi.fn(),
      get: vi.fn(() => sessionEntry),
      getEntries: vi.fn(() => [sessionEntry, childEntry]),
      remove: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryCache
    const nextSession = { account: { userId: 'user-2' }, authenticated: true }

    clearAuthenticatedQueriesAfterSessionTransition(queryCache, nextSession)

    expect(queryCache.cancelQueries).toHaveBeenCalledWith(
      { exact: true, key: childEntry.key },
      expect.any(Error),
    )
    expect(queryCache.remove).toHaveBeenCalledWith(childEntry)
    expect(queryCache.setQueryData).toHaveBeenCalledWith(['private', 'session'], nextSession)
  })

  it('retains canonical authorization and organization refusal metadata', async () => {
    const error = await toApiQueryError(
      new Response(
        JSON.stringify({
          code: 'organization-review-required',
          message: 'Review required.',
          reviewDeadline: '2026-09-07T00:00:00.000Z',
          state: 'review-required',
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 403 },
      ),
      'Request failed.',
    )

    expect(error).toBeInstanceOf(ApiQueryError)
    expect(reviveApiQueryError(reduceApiQueryError(error) || fail())).toMatchObject({
      reviewDeadline: '2026-09-07T00:00:00.000Z',
      state: 'review-required',
    })
  })

  it('constructs validated EVE image URLs', () => {
    const images = createEveImages('https://images.example.test///')
    expect(images.characterPortrait(7, 64)).toBe(
      'https://images.example.test/characters/7/portrait?size=64&tenant=tranquility',
    )
    expect(() => images.corporationLogo('invalid')).toThrow(TypeError)
  })
})

function queryEntry(key: EntryKey) {
  return { key } as UseQueryEntry
}
