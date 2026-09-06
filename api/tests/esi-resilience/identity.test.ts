import { describe, expect, test } from 'vitest'
import { createEsiRepresentationIdentity } from '../../src/esi-resilience/identity.js'

const compatibilityDate = '2026-08-23'
const representationVersion = 'character-profile-v1'

describe('ESI representation identity', () => {
  test('canonicalizes set-like inputs independently of order and duplicates', () => {
    const first = identity('universe-resolve-names', { ids: [30, 10, 20, 10] })
    const second = identity('universe-resolve-names', { ids: [20, 30, 10] })

    expect(first).toEqual(second)
    expect(first.digest).toMatch(/^[a-f\d]{64}$/)
    expect(first.value).toBe(`universe-resolve-names:${first.digest}`)
  })

  test('canonicalizes exact player-supplied strings with code-unit ordering', () => {
    const first = identity('universe-resolve-names', { ids: ['Åke', 'Ake', 'a', 'A'] })
    const second = identity('universe-resolve-names', { ids: ['A', 'a', 'Ake', 'Åke'] })

    expect(first).toEqual(second)
  })

  test('preserves exact order and spelling in ordered scalar inputs', () => {
    const first = identity('public-character', { characterId: 'Token Secret Pilot' })
    const reordered = identity('public-character', { characterId: 'Pilot Secret Token' })
    const respelled = identity('public-character', { characterId: 'token secret pilot' })

    expect(first.digest).not.toBe(reordered.digest)
    expect(first.digest).not.toBe(respelled.digest)
  })

  test('projects identity fields from validated SDK request envelopes', () => {
    const flat = identity('wallet-balance', { characterId: 42 })
    const path = identity('wallet-balance', { path: { character_id: 42 } })
    const batch = identity('universe-resolve-names', { body: { ids: [20, 10] } })

    expect(path).toEqual(flat)
    expect(batch).toEqual(identity('universe-resolve-names', { ids: [10, 20] }))
  })

  test('separates operations, compatibility dates, and representation versions', () => {
    const races = identity('universe-races', {})
    const bloodlines = identity('universe-bloodlines', {})
    const compatibilityChange = createEsiRepresentationIdentity({
      operation: 'universe-races',
      inputs: {},
      compatibilityDate: '2026-08-24',
      representationVersion,
    })
    const representationChange = createEsiRepresentationIdentity({
      operation: 'universe-races',
      inputs: {},
      compatibilityDate,
      representationVersion: 'character-profile-v2',
    })

    expect(
      new Set([
        races.digest,
        bloodlines.digest,
        compatibilityChange.digest,
        representationChange.digest,
      ]),
    ).toHaveLength(4)
  })

  test('canonicalizes mixed mailbox identity fields and explicit absence', () => {
    const first = identity('mail-headers', {
      characterId: 1,
      labels: [30, 10, 20, 10],
      lastMailId: null,
    })
    const reordered = identity('mail-headers', {
      characterId: 1,
      labels: [20, 30, 10],
      lastMailId: null,
    })
    const unfiltered = identity('mail-headers', {
      characterId: 1,
      labels: null,
      lastMailId: null,
    })
    const omitted = identity('mail-headers', {
      path: { character_id: 1 },
      query: { labels: undefined, last_mail_id: undefined },
    })
    const empty = identity('mail-headers', {
      characterId: 1,
      labels: [],
      lastMailId: undefined,
    })

    expect(first).toEqual(reordered)
    expect(first.digest).not.toBe(unfiltered.digest)
    expect(omitted).toEqual(unfiltered)
    expect(empty).toEqual(unfiltered)
    expect(() =>
      identity('mail-headers', {
        characterId: 1,
        labels: Array.from({ length: 26 }, (_, index) => index + 1),
        lastMailId: null,
      }),
    ).toThrow('between 1 and 25 items')
  })

  test('canonicalizes optional transaction continuations and isolates Finance ranges', () => {
    const newest = identity('wallet-transactions', {
      path: { character_id: 1 },
      query: { from_id: undefined },
    })
    const explicitNewest = identity('wallet-transactions', { characterId: 1, fromId: null })
    const older = identity('wallet-transactions', { characterId: 1, fromId: 42 })
    const otherRange = identity('wallet-transactions', { characterId: 1, fromId: 41 })

    expect(newest).toEqual(explicitNewest)
    expect(newest.digest).not.toBe(older.digest)
    expect(older.digest).not.toBe(otherRange.digest)
    expect(identity('wallet-journal', { characterId: 1, page: 1 }).digest).not.toBe(
      identity('wallet-journal', { characterId: 1, page: 2 }).digest,
    )
    expect(
      identity('character-contract-items', { characterId: 1, contractId: 10 }).digest,
    ).not.toBe(identity('character-contract-items', { characterId: 1, contractId: 11 }).digest)
  })

  test('isolates asset pages and canonicalizes character-bound asset name sets', () => {
    const firstPage = identity('character-assets-page', { characterId: 1, page: 1 })
    const secondPage = identity('character-assets-page', { characterId: 1, page: 2 })
    const firstNames = identity('character-asset-names', {
      characterId: 1,
      itemIds: [30, 10, 20],
    })
    const reorderedNames = identity('character-asset-names', {
      characterId: 1,
      itemIds: [20, 30, 10],
    })
    const otherCharacter = identity('character-asset-names', {
      characterId: 2,
      itemIds: [10, 20, 30],
    })

    expect(firstPage.digest).not.toBe(secondPage.digest)
    expect(firstNames).toEqual(reorderedNames)
    expect(firstNames.digest).not.toBe(otherCharacter.digest)
  })

  test('separates mailbox identities by resource revision', () => {
    const base = {
      operation: 'mail-message' as const,
      inputs: { characterId: 1, mailId: 2 },
      compatibilityDate,
      representationVersion,
    }

    const first = createEsiRepresentationIdentity({
      ...base,
      resourceRevision: { namespace: 'mailbox', value: 1 },
    })
    const second = createEsiRepresentationIdentity({
      ...base,
      resourceRevision: { namespace: 'mailbox', value: 2 },
    })

    expect(first.digest).not.toBe(second.digest)
    expect(first.coordinationDigest).toBe(second.coordinationDigest)
    expect(first.resourceRevision).toEqual({ namespace: 'mailbox', value: 1 })
  })

  test('rejects oversized batches and scalar values before hashing', () => {
    expect(() =>
      identity('universe-resolve-names', {
        ids: Array.from({ length: 1_001 }, (_, index) => index + 1),
      }),
    ).toThrow('between 1 and 1000 items')
    expect(() => identity('public-character', { characterId: 'x'.repeat(257) })).toThrow(
      'exceeds 256 characters',
    )
  })

  test('excludes authority structurally without rejecting credential-like player values', () => {
    expect(() =>
      identity('public-character', { characterId: 'Bearer Token Secret Session' }),
    ).not.toThrow()
    expect(() =>
      identity('public-character', {
        characterId: 90_000_001,
        accessToken: 'must-not-enter-an-identity',
      }),
    ).toThrow('Unexpected ESI identity inputs: accessToken')
  })
})

function identity(
  operation: Parameters<typeof createEsiRepresentationIdentity>[0]['operation'],
  inputs: Readonly<Record<string, unknown>>,
) {
  return createEsiRepresentationIdentity({
    operation,
    inputs,
    compatibilityDate,
    representationVersion,
  })
}
