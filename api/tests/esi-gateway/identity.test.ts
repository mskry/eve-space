import { describe, expect, test } from 'vitest'
import { getEsiOperationContract } from '../../src/esi-gateway/internal/catalog-access.js'
import { createEsiRepresentationIdentity } from '../../src/esi-gateway/internal/identity.js'
import {
  getGeneratedEsiMaximumBatchSize,
  getGeneratedEsiOperationFacts,
} from '../../src/esi-gateway/internal/operation-metadata.js'

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
    const batch = identity('universe-resolve-names', { body: [20, 10] })

    expect(path).toEqual(flat)
    expect(batch).toEqual(identity('universe-resolve-names', { ids: [10, 20] }))
  })

  test('projects all registered array bodies from their post-migration SDK envelopes', () => {
    expect(identity('universe-resolve-names', { body: [30, 10, 20, 10] })).toEqual(
      identity('universe-resolve-names', { ids: [20, 30, 10] }),
    )
    expect(identity('universe-resolve-ids', { body: ['Jita', 'Amarr', 'Jita'] })).toEqual(
      identity('universe-resolve-ids', { names: ['Amarr', 'Jita'] }),
    )
    expect(
      identity('character-asset-names', {
        path: { character_id: 7 },
        body: [30, 10, 20, 10],
      }),
    ).toEqual(identity('character-asset-names', { characterId: 7, itemIds: [20, 30, 10] }))
    expect(identity('bulk-affiliation', { body: [30, 10, 20, 10] })).toEqual(
      identity('bulk-affiliation', { characterIds: [20, 30, 10] }),
    )
    expect(
      identity('character-cspa-charge', {
        path: { character_id: 7 },
        body: [30, 10, 20],
      }),
    ).toEqual(identity('character-cspa-charge', { characterId: 7 }))
  })

  test('does not recursively recover array-body identity fields from decoy objects', () => {
    for (const [operation, inputs] of [
      ['universe-resolve-names', { body: { ids: [10, 20] } }],
      ['universe-resolve-ids', { body: { names: ['Amarr', 'Jita'] } }],
      [
        'character-asset-names',
        {
          path: { nested: { character_id: 7 } },
          body: { nested: { item_ids: [10, 20] } },
        },
      ],
      ['bulk-affiliation', { body: { characterIds: [10, 20] } }],
      ['character-cspa-charge', { path: { nested: { character_id: 7 } }, body: [10, 20] }],
    ] as const)
      expect(() => identity(operation, inputs)).toThrow(/ESI identity/)
  })

  test('fails closed on empty and oversized post-migration array bodies', () => {
    const cases = [
      ['universe-resolve-names', {}, getGeneratedEsiMaximumBatchSize('universe-resolve-names') + 1],
      ['universe-resolve-ids', {}, getGeneratedEsiMaximumBatchSize('universe-resolve-ids') + 1],
      [
        'character-asset-names',
        { path: { character_id: 7 } },
        getGeneratedEsiMaximumBatchSize('character-asset-names') + 1,
      ],
      ['bulk-affiliation', {}, getGeneratedEsiMaximumBatchSize('bulk-affiliation') + 1],
      [
        'character-cspa-charge',
        { path: { character_id: 7 } },
        getGeneratedEsiMaximumBatchSize('character-cspa-charge') + 1,
      ],
    ] as const

    for (const [operation, envelope, oversizedLength] of cases) {
      expect(() => identity(operation, { ...envelope, body: [] })).toThrow('between 1 and')
      expect(() =>
        identity(operation, {
          ...envelope,
          body: Array.from({ length: oversizedLength }, (_, index) => index + 1),
        }),
      ).toThrow('between 1 and')
    }
  })

  test('keeps distinct projected sets separate and ignores the CSPA recipient set by contract', () => {
    expect(identity('universe-resolve-names', { body: [10, 20] }).digest).not.toBe(
      identity('universe-resolve-names', { body: [10, 30] }).digest,
    )
    expect(identity('universe-resolve-ids', { body: ['Amarr'] }).digest).not.toBe(
      identity('universe-resolve-ids', { body: ['Jita'] }).digest,
    )
    expect(
      identity('character-asset-names', { path: { character_id: 7 }, body: [10] }).digest,
    ).not.toBe(identity('character-asset-names', { path: { character_id: 7 }, body: [20] }).digest)
    expect(identity('bulk-affiliation', { body: [10] }).digest).not.toBe(
      identity('bulk-affiliation', { body: [20] }).digest,
    )
    expect(identity('character-cspa-charge', { path: { character_id: 7 }, body: [10] })).toEqual(
      identity('character-cspa-charge', { path: { character_id: 7 }, body: [20] }),
    )
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
        labels: Array.from(
          { length: getGeneratedEsiMaximumBatchSize('mail-headers') + 1 },
          (_, index) => index + 1,
        ),
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
        ids: Array.from(
          { length: getGeneratedEsiMaximumBatchSize('universe-resolve-names') + 1 },
          (_, index) => index + 1,
        ),
      }),
    ).toThrow('between 1 and 1000 items')
    expect(() => identity('public-character', { characterId: 'x'.repeat(257) })).toThrow(
      'exceeds 256 characters',
    )
  })

  test('derives mixed set identity bounds from generated request-array limits', () => {
    for (const operation of ['character-asset-names', 'mail-headers'] as const) {
      const contractIdentity = getEsiOperationContract(operation).identity
      const generatedLimits = getGeneratedEsiOperationFacts(operation).requestArrayLimits
      const identityLimits =
        contractIdentity.kind === 'mixed'
          ? contractIdentity.fields.flatMap((field) =>
              field.kind === 'set' ? [field.maximumItems] : [],
            )
          : []

      expect(identityLimits).toEqual(generatedLimits.map(({ maximumItems }) => maximumItems))
    }
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
