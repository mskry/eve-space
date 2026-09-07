import type { EntryKey, QueryCache, UseQueryEntry } from '@pinia/colada'
import { describe, expect, it, vi } from 'vitest'
import { createEveImages } from '../src/runtime/eve-images.js'
import {
  canRunPlatformProtectedQuery,
  removePlatformModuleQueries,
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

describe('platform module runtime surface', () => {
  it('binds module queries to authoritative private subjects', () => {
    expect(
      platformModuleQueryKey('activity', { kind: 'character', characterId: 7 }, ['feed']),
    ).toEqual(['private', 'characters', 7, 'modules', 'activity', 'feed'])
    expect(
      platformModuleQueryKey(
        'activity',
        { kind: 'corporation', corporationId: 99, organizationVersion: 3 },
        ['feed'],
      ),
    ).toEqual(['private', 'organization', 3, 'corporations', 99, 'modules', 'activity', 'feed'])
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
        subject: { kind: 'character', characterId: 7 },
      }),
    ).toBe(false)
    expect(
      canRunPlatformProtectedQuery({
        authenticated: true,
        isClient: true,
        moduleEnabled: true,
        ownsCharacter: true,
        subject: { kind: 'character', characterId: Number.NaN },
      }),
    ).toBe(false)
  })

  it('distinguishes exact query removal from prefix scope removal', () => {
    const rootEntry = queryEntry(['private', 'characters', 7])
    const childEntry = queryEntry(['private', 'characters', 7, 'modules', 'activity'])
    const queryCache = {
      getEntries: vi.fn(({ exact }: { exact?: boolean }) =>
        exact ? [rootEntry] : [rootEntry, childEntry],
      ),
      cancelQueries: vi.fn(),
      remove: vi.fn(),
    } as unknown as QueryCache

    removePlatformQuery(queryCache, rootEntry.key)

    expect(queryCache.getEntries).toHaveBeenLastCalledWith({ key: rootEntry.key, exact: true })
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
      getEntries: vi.fn(() => [activityEntry, otherEntry]),
      cancel: vi.fn(),
      remove: vi.fn(),
    } as unknown as QueryCache

    removePlatformModuleQueries(queryCache, 'activity')

    expect(queryCache.cancel).toHaveBeenCalledOnce()
    expect(queryCache.remove).toHaveBeenCalledWith(activityEntry)
    expect(queryCache.remove).not.toHaveBeenCalledWith(otherEntry)
  })

  it('retains canonical authorization and organization refusal metadata', async () => {
    const error = await toApiQueryError(
      new Response(
        JSON.stringify({
          code: 'organization-review-required',
          message: 'Review required.',
          state: 'review-required',
          reviewDeadline: '2026-09-07T00:00:00.000Z',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
      'Request failed.',
    )

    expect(error).toBeInstanceOf(ApiQueryError)
    expect(reviveApiQueryError(reduceApiQueryError(error) || fail())).toMatchObject({
      state: 'review-required',
      reviewDeadline: '2026-09-07T00:00:00.000Z',
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
