import type { QueryMeta } from '@pinia/colada'
import { describe, expect, it } from 'vitest'
import type { CacheAdmissionContext } from '../../app/queries/auth'
import {
  PERSISTED_ESI_QUERY_CACHE_RETENTION_MS,
  parsePersistedEnvelope,
  serializePersistedEnvelope,
  shouldPersistEsiQuery,
  type EsiQueryCacheEnvelope,
  type PersistedQueryTuple,
} from '../../app/query-persistence/envelope'

const NOW = Date.parse('2026-09-14T11:00:00.000Z')
const PUBLIC_KEY = ['public', 'characters', 7] as const
const CHARACTER_KEY = ['private', 'characters', 7, 'overview'] as const
const ORGANIZATION_KEY = ['private', 'organization', 'activities'] as const
const ORGANIZATION_SCOPE = 'organization:v1:core:member:organization.activities'

describe('query persistence envelope policy', () => {
  it('filters by coherent typed metadata rather than a key prefix', () => {
    expect(shouldPersistEsiQuery(candidate(PUBLIC_KEY, { kind: 'public-esi' }))).toBe(true)
    expect(
      shouldPersistEsiQuery(candidate(CHARACTER_KEY, { kind: 'character-esi', characterId: 7 })),
    ).toBe(true)
    expect(
      shouldPersistEsiQuery(
        candidate(ORGANIZATION_KEY, {
          kind: 'organization-esi',
          admissionScope: ORGANIZATION_SCOPE,
        }),
      ),
    ).toBe(true)
    expect(shouldPersistEsiQuery(candidate(['private', 'session'], { kind: 'none' }))).toBe(false)
    expect(
      shouldPersistEsiQuery(candidate(PUBLIC_KEY, { kind: 'character-esi', characterId: 7 })),
    ).toBe(false)
  })

  it('serializes successful tuples into independently admitted partitions', () => {
    const result = serializePersistedEnvelope(
      {
        [JSON.stringify(PUBLIC_KEY)]: tuple({ name: 'Public' }, NOW, {
          kind: 'public-esi',
        }),
        [JSON.stringify(CHARACTER_KEY)]: tuple({ name: 'Character' }, NOW, {
          kind: 'character-esi',
          characterId: 7,
        }),
        [JSON.stringify(ORGANIZATION_KEY)]: tuple({ name: 'Organization' }, NOW, {
          kind: 'organization-esi',
          admissionScope: ORGANIZATION_SCOPE,
        }),
        '["private","session"]': tuple({ authenticated: true }, NOW, { kind: 'none' }),
      },
      serializeOptions(),
    )

    expect(JSON.parse(result.serialized)).toEqual(envelopeWithPrivatePartitions(NOW))
  })

  it('rejects unsupported, corrupt, and incoherently partitioned envelopes', () => {
    expect(() =>
      parsePersistedEnvelope(JSON.stringify({ ...emptyEnvelope(), version: 2 }), NOW),
    ).toThrow('version is unsupported')
    expect(() =>
      parsePersistedEnvelope(
        JSON.stringify({
          ...emptyEnvelope(),
          public: {
            [JSON.stringify(CHARACTER_KEY)]: tuple({ name: 'Character' }, NOW, {
              kind: 'character-esi',
              characterId: 7,
            }),
          },
        }),
        NOW,
      ),
    ).toThrow('entry is invalid')
    expect(() => parsePersistedEnvelope('{', NOW)).toThrow(SyntaxError)
  })

  it.each([
    [
      'future timestamp',
      {
        ...envelopeWithPrivatePartitions(NOW),
        public: {
          [JSON.stringify(PUBLIC_KEY)]: tuple({ name: 'Future' }, NOW + 1, {
            kind: 'public-esi',
          }),
        },
      },
      'timestamp is invalid',
    ],
    [
      'malformed key',
      {
        ...envelopeWithPrivatePartitions(NOW),
        public: {
          'not-json': tuple({ name: 'Malformed' }, NOW, { kind: 'public-esi' }),
        },
      },
      'not valid JSON',
    ],
    [
      'negative generation',
      { ...envelopeWithPrivatePartitions(NOW), invalidationGeneration: -1 },
      'generation is invalid',
    ],
    [
      'empty character owner',
      {
        ...envelopeWithPrivatePartitions(NOW),
        characters: {
          7: { ...envelopeWithPrivatePartitions(NOW).characters['7']!, ownerUserId: '' },
        },
      },
      'character cache admission binding is invalid',
    ],
    [
      'empty character revision',
      {
        ...envelopeWithPrivatePartitions(NOW),
        characters: {
          7: {
            ...envelopeWithPrivatePartitions(NOW).characters['7']!,
            admissionRevision: '',
          },
        },
      },
      'character cache admission binding is invalid',
    ],
    [
      'invalid organization version',
      {
        ...envelopeWithPrivatePartitions(NOW),
        organizations: {
          [ORGANIZATION_SCOPE]: {
            ...envelopeWithPrivatePartitions(NOW).organizations[ORGANIZATION_SCOPE]!,
            organizationVersion: 0,
          },
        },
      },
      'organization cache admission binding is invalid',
    ],
    [
      'empty organization revision',
      {
        ...envelopeWithPrivatePartitions(NOW),
        organizations: {
          [ORGANIZATION_SCOPE]: {
            ...envelopeWithPrivatePartitions(NOW).organizations[ORGANIZATION_SCOPE]!,
            admissionRevision: '',
          },
        },
      },
      'organization cache admission binding is invalid',
    ],
    [
      'malformed organization deadline',
      {
        ...envelopeWithPrivatePartitions(NOW),
        organizations: {
          [ORGANIZATION_SCOPE]: {
            ...envelopeWithPrivatePartitions(NOW).organizations[ORGANIZATION_SCOPE]!,
            validUntil: 'tomorrow',
          },
        },
      },
      'organization cache admission binding is invalid',
    ],
  ] as const)('rejects a %s', (_label, stored, message) => {
    expect(() => parsePersistedEnvelope(JSON.stringify(stored), NOW)).toThrow(message)
  })

  it('drops non-JSON data during serialization', () => {
    const keyHash = JSON.stringify(PUBLIC_KEY)

    const result = serializePersistedEnvelope(
      {
        [keyHash]: tuple({ loadedAt: new Date(NOW) }, NOW, { kind: 'public-esi' }),
      },
      serializeOptions(),
    )

    expect(result.envelope.public).toEqual({})
  })

  it('drops tuples at their absolute retention boundary', () => {
    const stored = emptyEnvelope()
    stored.public[JSON.stringify(PUBLIC_KEY)] = tuple(
      { name: 'Expired' },
      NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS,
      { kind: 'public-esi' },
    )

    expect(parsePersistedEnvelope(JSON.stringify(stored), NOW)).toMatchObject({
      envelope: { public: {} },
      pruned: true,
    })
  })

  it('uses the centralized original success time instead of plugin arrival time', () => {
    const originalSuccessAt = NOW - 60_000
    const keyHash = JSON.stringify(PUBLIC_KEY)
    const options = serializeOptions()
    const result = serializePersistedEnvelope(
      {
        [keyHash]: tuple({ name: 'Stale response' }, NOW, {
          kind: 'public-esi',
        }),
      },
      {
        ...options,
        readOriginalSuccessTime: (candidateKeyHash) =>
          candidateKeyHash === keyHash ? originalSuccessAt : undefined,
      },
    )

    expect(result.envelope.public[keyHash]?.[2]).toBe(originalSuccessAt)
  })

  it.each([
    ['missing', undefined],
    ['future', NOW + 1],
    ['expired', NOW - PERSISTED_ESI_QUERY_CACHE_RETENTION_MS],
  ] as const)(
    'does not persist a successful tuple with a %s original timestamp',
    (_label, when) => {
      const keyHash = JSON.stringify(PUBLIC_KEY)
      const options = serializeOptions()
      const result = serializePersistedEnvelope(
        {
          [keyHash]: tuple({ stale: true }, NOW, {
            kind: 'public-esi',
          }),
        },
        {
          ...options,
          readOriginalSuccessTime: (candidateKeyHash) =>
            candidateKeyHash === keyHash ? when : undefined,
        },
      )

      expect(result.envelope.public).toEqual({})
    },
  )

  it('retains the prior tuple and timestamp when a refresh fails', () => {
    const keyHash = JSON.stringify(PUBLIC_KEY)
    const priorEnvelope = emptyEnvelope()
    priorEnvelope.public[keyHash] = tuple({ name: 'Prior' }, NOW - 60_000, {
      kind: 'public-esi',
    })

    const result = serializePersistedEnvelope(
      {},
      {
        ...serializeOptions(),
        hasFailedData: (candidateKeyHash) => candidateKeyHash === keyHash,
        hasQuarantinedData: () => false,
        priorEnvelope,
      },
    )

    expect(result.envelope.public[keyHash]).toEqual(priorEnvelope.public[keyHash])
  })

  it('retains admitted character and organization tuples when their refreshes fail', () => {
    const priorEnvelope = envelopeWithPrivatePartitions(NOW - 60_000)
    const failedKeys = new Set([JSON.stringify(CHARACTER_KEY), JSON.stringify(ORGANIZATION_KEY)])

    const result = serializePersistedEnvelope(
      {},
      {
        ...serializeOptions(),
        hasFailedData: (keyHash) => failedKeys.has(keyHash),
        hasQuarantinedData: () => false,
        priorEnvelope,
      },
    )

    expect(result.envelope.characters).toEqual(priorEnvelope.characters)
    expect(result.envelope.organizations).toEqual(priorEnvelope.organizations)
  })

  it.each([
    ['character revision', admission({ characterRevision: 'character-revision-2' }), false, true],
    ['organization version', admission({ organizationVersion: 4 }), true, false],
    [
      'organization revision',
      admission({ organizationRevision: 'organization-revision-2' }),
      true,
      false,
    ],
    ['organization scope', admission({ admissionScopes: [] }), true, false],
    [
      'organization deadline',
      admission({ organizationValidUntil: new Date(NOW + 60_000).toISOString() }),
      true,
      false,
    ],
  ] as const)(
    'rejects failed-refresh merging across a mismatched %s binding',
    (_label, nextAdmission, characterRetained, organizationRetained) => {
      const priorEnvelope = envelopeWithPrivatePartitions(NOW - 60_000)
      const result = serializePersistedEnvelope(
        {},
        {
          ...serializeOptions(),
          admission: nextAdmission,
          hasFailedData: () => true,
          hasQuarantinedData: () => false,
          priorEnvelope,
        },
      )

      expect(Object.keys(result.envelope.characters).length > 0).toBe(characterRetained)
      expect(Object.keys(result.envelope.organizations).length > 0).toBe(organizationRetained)
    },
  )
})

function serializeOptions() {
  const originalSuccessTimes = new Map([
    [JSON.stringify(PUBLIC_KEY), NOW],
    [JSON.stringify(CHARACTER_KEY), NOW],
    [JSON.stringify(ORGANIZATION_KEY), NOW],
  ])
  return {
    admission: admission(),
    durableGenerationVerified: true,
    generation: 0,
    hasFailedData: () => false,
    hasQuarantinedData: () => false,
    isRemovalTombstoned: () => false,
    now: NOW,
    priorEnvelope: emptyEnvelope(),
    privatePersistenceEnabled: true,
    readOriginalSuccessTime: (keyHash: string) => originalSuccessTimes.get(keyHash),
    retainedPrivateAccessOpen: true,
    verifiedUserId: 'user-1',
  }
}

function candidate(key: readonly unknown[], esiPersistence: Parameters<typeof tuple>[2]) {
  return { key, meta: { esiPersistence } as QueryMeta }
}

function tuple(
  data: unknown,
  when: number,
  esiPersistence:
    | { readonly kind: 'none' }
    | { readonly kind: 'public-esi' }
    | { readonly kind: 'character-esi'; readonly characterId: number }
    | { readonly kind: 'organization-esi'; readonly admissionScope: string },
): PersistedQueryTuple {
  return [data, null, when, { esiPersistence }]
}

function emptyEnvelope(): EsiQueryCacheEnvelope {
  return {
    version: 1,
    invalidationGeneration: 0,
    public: {},
    characters: {},
    organizations: {},
  }
}

function envelopeWithPrivatePartitions(when: number): EsiQueryCacheEnvelope {
  return {
    version: 1,
    invalidationGeneration: 0,
    public: {
      [JSON.stringify(PUBLIC_KEY)]: tuple({ name: 'Public' }, when, { kind: 'public-esi' }),
    },
    characters: {
      7: {
        ownerUserId: 'user-1',
        admissionRevision: 'character-revision-1',
        cache: {
          [JSON.stringify(CHARACTER_KEY)]: tuple({ name: 'Character' }, when, {
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
          [JSON.stringify(ORGANIZATION_KEY)]: tuple({ name: 'Organization' }, when, {
            kind: 'organization-esi',
            admissionScope: ORGANIZATION_SCOPE,
          }),
        },
      },
    },
  }
}

function admission(
  overrides: {
    readonly admissionScopes?: readonly string[]
    readonly characterRevision?: string | null
    readonly organizationRevision?: string
    readonly organizationValidUntil?: string | null
    readonly organizationVersion?: number
  } = {},
): CacheAdmissionContext {
  return {
    userId: 'user-1',
    characters: [
      {
        characterId: 7,
        admissionRevision:
          overrides.characterRevision === undefined
            ? 'character-revision-1'
            : overrides.characterRevision,
      },
    ],
    organization: {
      organizationVersion: overrides.organizationVersion ?? 3,
      admissionRevision: overrides.organizationRevision ?? 'organization-revision-1',
      validUntil: overrides.organizationValidUntil ?? null,
      admissionScopes: overrides.admissionScopes ?? [ORGANIZATION_SCOPE],
    },
  }
}
