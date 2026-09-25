import { describe, expect, test, vi } from 'vitest'
import {
  appendDomainEvent,
  claimPendingDomainEvents,
  deletePublishedDomainEvents,
  listPublishedDomainEventIdsForRedrive,
  redrivePublishedDomainEvents,
  recordDomainEventPublishFailure,
} from '../../src/domain-events/store.js'
import {
  assertSecretFreePayload,
  categorizeRelayFailure,
  DomainEventValidationError,
  listDomainEventDefinitions,
  RelayPublicationError,
  validateDomainEventInput,
  validateStoredDomainEvent,
} from '../../src/domain-events/definitions.js'
import { normalizeScopeSet } from '../../src/scopes.js'

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'
interface RecursivePayload {
  child?: RecursivePayload
}

describe('domain event registry', () => {
  test('registers every initial event at payload version 1', () => {
    expect(listDomainEventDefinitions()).toStrictEqual([
      { aggregateType: 'character', payloadVersion: 1, type: 'character.attached' },
      { aggregateType: 'character', payloadVersion: 1, type: 'character.detached' },
      { aggregateType: 'user', payloadVersion: 1, type: 'character.main-changed' },
      { aggregateType: 'character', payloadVersion: 1, type: 'character.scopes-changed' },
      { aggregateType: 'character', payloadVersion: 1, type: 'character.affiliation-observed' },
      {
        aggregateType: 'character',
        payloadVersion: 1,
        type: 'character.corporation-roles-changed',
      },
      {
        aggregateType: 'character',
        payloadVersion: 1,
        type: 'character.corporation-role-loss-confirmed',
      },
      { aggregateType: 'deployment', payloadVersion: 1, type: 'organization.changed' },
      { aggregateType: 'user', payloadVersion: 1, type: 'organization.member-blocked' },
      { aggregateType: 'user', payloadVersion: 1, type: 'organization.member-unblocked' },
      {
        aggregateType: 'deployment',
        payloadVersion: 1,
        type: 'organization.managed-corporation-added',
      },
      {
        aggregateType: 'deployment',
        payloadVersion: 1,
        type: 'organization.managed-corporation-removed',
      },
      {
        aggregateType: 'user',
        payloadVersion: 1,
        type: 'organization.compliance-transitioned',
      },
    ])
  })

  test('normalizes scopes deterministically during producer validation', () => {
    expect(normalizeScopeSet(['scope-z', 'scope-a', 'scope-z'])).toStrictEqual([
      'scope-a',
      'scope-z',
    ])
    const event = validateDomainEventInput({
      aggregateId: '1404328063',
      payload: {
        addedScopes: [' scope-z ', 'scope-a', 'scope-z'],
        characterId: 1_404_328_063,
        removedScopes: [],
        userId,
      },
      payloadVersion: 1,
      type: 'character.scopes-changed',
    })
    expect(event).toMatchObject({ payload: { addedScopes: ['scope-a', 'scope-z'] } })
  })

  test.each([
    {
      aggregateId: '1404328063',
      payload: characterLifecyclePayload(),
      payloadVersion: 1,
      type: 'character.detached',
    },
    {
      aggregateId: userId,
      payload: { newMainCharacterId: 2, previousMainCharacterId: 1, userId },
      payloadVersion: 1,
      type: 'character.main-changed',
    },
    {
      aggregateId: '1404328063',
      payload: {
        addedScopes: ['scope-z', 'scope-a'],
        characterId: 1_404_328_063,
        removedScopes: ['scope-old'],
        userId,
      },
      payloadVersion: 1,
      type: 'character.scopes-changed',
    },
    {
      aggregateId: '1',
      payload: {
        actorAdminId: userId,
        organizationId: 99_000_001,
        organizationType: 'alliance',
        organizationVersion: 2,
        previousOrganizationId: 98_000_001,
        previousOrganizationType: 'corporation',
        previousOrganizationVersion: 1,
      },
      payloadVersion: 1,
      type: 'organization.changed',
    },
  ] as const)('validates $type v$payloadVersion', (input) => {
    expect(validateDomainEventInput(input)).toMatchObject({
      aggregateId: input.aggregateId,
      payloadVersion: 1,
      type: input.type,
    })
  })

  describe('corporation-role transitions', () => {
    const rolePayload = () => ({
      affiliationPeriodRevision: '7ad4c3a1-0b0d-4f07-8a11-5d7a0c2f5e11',
      authorityCorporationId: 98_000_001,
      authorizationGeneration: 3,
      characterId: 1_404_328_063,
      currentRoleRevision: '9f2b8a4e-3c61-4b9f-a0a1-0f6f7e6d5c4b',
      organizationVersion: 2,
      previousRoleRevision: '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6',
      subjectLifecycleId: '5b6c7d8e-9f01-4a23-8b45-6c7d8e9f0a1b',
      userId,
    })

    test.each([
      'character.corporation-roles-changed',
      'character.corporation-role-loss-confirmed',
    ] as const)('accepts only opaque revisions and source identity for %s', (type) => {
      expect(
        validateDomainEventInput({
          aggregateId: '1404328063',
          payload: rolePayload(),
          payloadVersion: 1,
          type,
        }),
      ).toMatchObject({ aggregateType: 'character', payload: rolePayload(), type })
    })

    test.each([
      { roles: ['Director'] },
      { removedRoles: ['Director'] },
      { role: 'Director' },
      { rolesAtHeadquarters: [] },
      { esiResponse: { roles: ['Director'] } },
      { etag: '"abc"' },
      { cacheKey: 'character-corporation-roles:digest' },
      { accessToken: 'opaque' },
    ])('rejects role content, validators, cache identity, and credentials: %o', (extra) => {
      expect(() =>
        validateDomainEventInput({
          aggregateId: '1404328063',
          payload: { ...rolePayload(), ...extra },
          payloadVersion: 1,
          type: 'character.corporation-role-loss-confirmed',
        }),
      ).toThrow(DomainEventValidationError)
    })

    test('rejects a transition whose revision did not change', () => {
      const payload = rolePayload()
      expect(() =>
        validateDomainEventInput({
          aggregateId: '1404328063',
          payload: { ...payload, currentRoleRevision: payload.previousRoleRevision },
          payloadVersion: 1,
          type: 'character.corporation-roles-changed',
        }),
      ).toThrow(DomainEventValidationError)
    })
  })

  test('rejects unsupported versions and invalid event semantics', () => {
    expect(() =>
      validateDomainEventInput({
        aggregateId: '1404328063',
        payload: characterLifecyclePayload(),
        payloadVersion: 2,
        type: 'character.attached',
      }),
    ).toThrow(DomainEventValidationError)
    expect(() =>
      validateDomainEventInput({
        aggregateId: userId,
        payload: { newMainCharacterId: 1, previousMainCharacterId: 1, userId },
        payloadVersion: 1,
        type: 'character.main-changed',
      }),
    ).toThrow(DomainEventValidationError)
    expect(() =>
      validateDomainEventInput({
        aggregateId: '1404328063',
        payload: { addedScopes: [], characterId: 1_404_328_063, removedScopes: [], userId },
        payloadVersion: 1,
        type: 'character.scopes-changed',
      }),
    ).toThrow(DomainEventValidationError)
    expect(() =>
      validateDomainEventInput({
        aggregateId: '1404328063',
        payload: {
          addedScopes: ['same'],
          characterId: 1_404_328_063,
          removedScopes: ['same'],
          userId,
        },
        payloadVersion: 1,
        type: 'character.scopes-changed',
      }),
    ).toThrow(DomainEventValidationError)
  })

  test.each([
    { accessToken: 'opaque' },
    { nested: { sessionBearer: 'opaque' } },
    { encryptionKey: 'opaque' },
  ])('rejects sensitive producer payload keys', (payload) => {
    expect(() => assertSecretFreePayload(payload)).toThrow(DomainEventValidationError)
  })

  test.each(['Top Secret', 'Secretariat', 'Bearer of Light', 'Sessions'])(
    'accepts player-controlled display text: %s',
    (characterName) => {
      expect(() => assertSecretFreePayload({ characterName })).not.toThrow()
    },
  )

  test('handles repeated object references without weakening secret detection', () => {
    const payload: RecursivePayload = {}
    payload.child = payload
    expect(() => assertSecretFreePayload([payload])).not.toThrow()
  })

  test('revalidates stored envelope type, version, aggregate, payload, and secrets', () => {
    const stored = storedAttachedEvent()
    expect(validateStoredDomainEvent(stored)).toMatchObject(stored)
    expect(() => validateStoredDomainEvent({ ...stored, payloadVersion: 2 })).toThrow(
      DomainEventValidationError,
    )
    expect(() => validateStoredDomainEvent({ ...stored, aggregateType: 'user' })).toThrow(
      DomainEventValidationError,
    )
    expect(() =>
      validateStoredDomainEvent({ ...stored, payload: { ...stored.payload, accessToken: 'no' } }),
    ).toThrow(DomainEventValidationError)
    expect(() => validateStoredDomainEvent({ ...stored, eventId: 'not-a-uuid' })).toThrow(
      DomainEventValidationError,
    )
  })
})

describe('outbox operation guards', () => {
  test('categorizes relay failures without retaining raw errors', () => {
    expect(categorizeRelayFailure(new RelayPublicationError('queue-rejected'))).toBe(
      'queue-rejected',
    )
    expect(categorizeRelayFailure(new DomainEventValidationError())).toBe('invalid-event')
    expect(categorizeRelayFailure({ code: 'ECONNREFUSED', message: 'private topology' })).toBe(
      'queue-unavailable',
    )
    expect(categorizeRelayFailure(new Error('private topology'))).toBe('unknown')
  })

  test('rejects unsafe claim, retention, failure, and re-drive bounds before querying', async () => {
    const transaction = vi.fn()
    const database = { transaction }

    await expect(
      claimPendingDomainEvents({ claimTtlMs: 1, limit: 0 }, database as never),
    ).rejects.toThrow('Too small')
    await expect(
      listPublishedDomainEventIdsForRedrive({ from: new Date(1), limit: 1, to: new Date(1) }, {
        select: vi.fn(),
      } as never),
    ).rejects.toThrow('Re-drive start must be before its end')
    await expect(
      listPublishedDomainEventIdsForRedrive({ from: new Date(1), limit: 1001, to: new Date(2) }, {
        select: vi.fn(),
      } as never),
    ).rejects.toThrow('Too big')
    await expect(
      deletePublishedDomainEvents({ retentionMs: 0 }, { delete: vi.fn() } as never),
    ).rejects.toThrow('Too small')
    await expect(
      recordDomainEventPublishFailure(
        {
          category: 'raw-error' as never,
          claimToken: eventId,
          eventId,
          retryDelayMs: 1,
        },
        { update: vi.fn() } as never,
      ),
    ).rejects.toThrow('Invalid option')
    await expect(
      redrivePublishedDomainEvents([eventId, eventId], new Date(), database as never),
    ).rejects.toThrow('unique')
    expect(transaction).not.toHaveBeenCalled()
  })

  test('validates producer payloads before using the caller transaction', async () => {
    const insert = vi.fn()
    await expect(
      appendDomainEvent(
        { insert } as never,
        {
          aggregateId: '1404328063',
          payload: { ...characterLifecyclePayload(), clientSecret: 'no' },
          payloadVersion: 1,
          type: 'character.attached',
        } as never,
      ),
    ).rejects.toThrow(DomainEventValidationError)
    expect(insert).not.toHaveBeenCalled()
  })
})

function characterLifecyclePayload() {
  return { characterId: 1_404_328_063, userId }
}

function storedAttachedEvent() {
  return {
    aggregateId: '1404328063',
    aggregateType: 'character',
    eventId,
    eventSequence: 1n,
    eventType: 'character.attached',
    occurredAt: new Date('2026-08-23T12:00:00.000Z'),
    payload: characterLifecyclePayload(),
    payloadVersion: 1,
  }
}
