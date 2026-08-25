import { describe, expect, test } from 'vitest'
import { createEsiRepresentationIdentity } from '../src/esi-resilience/identity.js'

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
