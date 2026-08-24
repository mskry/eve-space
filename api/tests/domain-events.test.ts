import { describe, expect, test, vi } from 'vitest'
import {
  appendDomainEvent,
  claimPendingDomainEvents,
  deletePublishedDomainEvents,
  listPublishedDomainEventIdsForRedrive,
  redrivePublishedDomainEvents,
  recordDomainEventPublishFailure,
} from '../src/domain-event-store.js'
import {
  assertSecretFreePayload,
  categorizeRelayFailure,
  DomainEventValidationError,
  listDomainEventDefinitions,
  normalizeScopeSet,
  RelayPublicationError,
  validateDomainEventInput,
  validateStoredDomainEvent,
} from '../src/domain-events.js'

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'

describe('domain event registry', () => {
  test('registers every initial event at payload version 1', () => {
    expect(listDomainEventDefinitions()).toEqual([
      { type: 'character.attached', payloadVersion: 1, aggregateType: 'character' },
      { type: 'character.detached', payloadVersion: 1, aggregateType: 'character' },
      { type: 'character.main-changed', payloadVersion: 1, aggregateType: 'user' },
      { type: 'character.scopes-changed', payloadVersion: 1, aggregateType: 'character' },
    ])
  })

  test('normalizes scopes deterministically during producer validation', () => {
    expect(normalizeScopeSet(['scope-z', 'scope-a', 'scope-z'])).toEqual(['scope-a', 'scope-z'])
    const event = validateDomainEventInput({
      type: 'character.attached',
      payloadVersion: 1,
      aggregateId: '1404328063',
      payload: characterSnapshot([' scope-z ', 'scope-a', 'scope-z']),
    })
    expect(event).toMatchObject({ payload: { scopes: ['scope-a', 'scope-z'] } })
  })

  test.each([
    {
      type: 'character.detached',
      payloadVersion: 1,
      aggregateId: '1404328063',
      payload: characterSnapshot([]),
    },
    {
      type: 'character.main-changed',
      payloadVersion: 1,
      aggregateId: userId,
      payload: { userId, previousMainCharacterId: 1, newMainCharacterId: 2 },
    },
    {
      type: 'character.scopes-changed',
      payloadVersion: 1,
      aggregateId: '1404328063',
      payload: {
        userId,
        characterId: 1404328063,
        addedScopes: ['scope-z', 'scope-a'],
        removedScopes: ['scope-old'],
      },
    },
  ] as const)('validates $type v$payloadVersion', (input) => {
    expect(validateDomainEventInput(input)).toMatchObject({
      type: input.type,
      payloadVersion: 1,
      aggregateId: input.aggregateId,
    })
  })

  test('rejects unsupported versions and invalid event semantics', () => {
    expect(() =>
      validateDomainEventInput({
        type: 'character.attached',
        payloadVersion: 2,
        aggregateId: '1404328063',
        payload: characterSnapshot([]),
      }),
    ).toThrow(DomainEventValidationError)
    expect(() =>
      validateDomainEventInput({
        type: 'character.main-changed',
        payloadVersion: 1,
        aggregateId: userId,
        payload: { userId, previousMainCharacterId: 1, newMainCharacterId: 1 },
      }),
    ).toThrow(DomainEventValidationError)
    expect(() =>
      validateDomainEventInput({
        type: 'character.scopes-changed',
        payloadVersion: 1,
        aggregateId: '1404328063',
        payload: { userId, characterId: 1404328063, addedScopes: [], removedScopes: [] },
      }),
    ).toThrow(DomainEventValidationError)
    expect(() =>
      validateDomainEventInput({
        type: 'character.scopes-changed',
        payloadVersion: 1,
        aggregateId: '1404328063',
        payload: {
          userId,
          characterId: 1404328063,
          addedScopes: ['same'],
          removedScopes: ['same'],
        },
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
      expect(
        validateDomainEventInput({
          type: 'character.attached',
          payloadVersion: 1,
          aggregateId: '1404328063',
          payload: { ...characterSnapshot([]), characterName },
        }),
      ).toMatchObject({ payload: { characterName } })
    },
  )

  test('handles repeated object references without weakening secret detection', () => {
    const payload: { child?: unknown } = {}
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
      claimPendingDomainEvents({ limit: 0, claimTtlMs: 1 }, database as never),
    ).rejects.toThrow('Too small')
    await expect(
      listPublishedDomainEventIdsForRedrive({ from: new Date(1), to: new Date(1), limit: 1 }, {
        select: vi.fn(),
      } as never),
    ).rejects.toThrow('Re-drive start must be before its end')
    await expect(
      listPublishedDomainEventIdsForRedrive({ from: new Date(1), to: new Date(2), limit: 1_001 }, {
        select: vi.fn(),
      } as never),
    ).rejects.toThrow('Too big')
    await expect(
      deletePublishedDomainEvents({ retentionMs: 0 }, { delete: vi.fn() } as never),
    ).rejects.toThrow('Too small')
    await expect(
      recordDomainEventPublishFailure(
        {
          eventId,
          claimToken: eventId,
          category: 'raw-error' as never,
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
          type: 'character.attached',
          payloadVersion: 1,
          aggregateId: '1404328063',
          payload: { ...characterSnapshot([]), clientSecret: 'no' },
        } as never,
      ),
    ).rejects.toThrow(DomainEventValidationError)
    expect(insert).not.toHaveBeenCalled()
  })
})

function characterSnapshot(scopes: string[]) {
  return {
    userId,
    characterId: 1404328063,
    characterName: 'Bandera Primary',
    corporationId: 1000166,
    allianceId: null,
    isMain: true,
    scopes,
  }
}

function storedAttachedEvent() {
  return {
    eventId,
    eventSequence: 1n,
    eventType: 'character.attached',
    payloadVersion: 1,
    aggregateType: 'character',
    aggregateId: '1404328063',
    payload: characterSnapshot(['scope-a']),
    occurredAt: new Date('2026-08-23T12:00:00.000Z'),
  }
}
