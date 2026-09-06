import { describe, expect, test, vi } from 'vitest'
import {
  createCharacterComplianceEventHandlers,
  createManagedCorporationComplianceEventHandlers,
  createPlatformCollectionStateEventHandlers,
  dispatchDomainEvent,
  DomainEventNotFoundError,
  verifyDomainEventHandlers,
  type DomainEventHandler,
} from '../../src/domain-events/handlers.js'

const eventId = '98a782d2-e042-47d7-9659-03b218121a1a'

describe('domain event handlers', () => {
  test('requires every handler to declare its idempotency boundary', () => {
    expect(() =>
      verifyDomainEventHandlers([
        { eventType: 'character.attached', payloadVersion: 1, handle: vi.fn() },
      ]),
    ).toThrow('must declare an idempotency strategy')
    expect(() =>
      verifyDomainEventHandlers([
        {
          eventType: 'character.attached',
          payloadVersion: 1,
          idempotency: 'event-id-persistence',
          handle: vi.fn(),
        },
        {
          eventType: 'character.detached',
          payloadVersion: 1,
          idempotency: 'convergent-state',
          handle: vi.fn(),
        },
      ]),
    ).not.toThrow()
  })

  test('loads the validated stored event before dispatching matching handlers', async () => {
    const event = storedEvent()
    const matching = handler('event-id-persistence')
    const other = { ...handler('convergent-state'), eventType: 'character.detached' as const }
    const loader = vi.fn().mockResolvedValue(event)

    await expect(dispatchDomainEvent(eventId, [matching, other], loader)).resolves.toBe(event)
    expect(loader).toHaveBeenCalledWith(eventId)
    expect(matching.handle).toHaveBeenCalledWith(event)
    expect(other.handle).not.toHaveBeenCalled()
  })

  test('fails permanently when the retained event cannot be loaded', async () => {
    await expect(
      dispatchDomainEvent(eventId, [], vi.fn().mockResolvedValue(null)),
    ).rejects.toBeInstanceOf(DomainEventNotFoundError)
  })

  test.each([
    'character.attached',
    'character.detached',
    'character.scopes-changed',
    'character.affiliation-observed',
  ] as const)('repairs current collection state for %s events', async (eventType) => {
    const repair = vi.fn().mockResolvedValue(undefined)
    const handlers = createPlatformCollectionStateEventHandlers(repair)
    const event = {
      ...storedEvent(),
      eventType,
      payload:
        eventType === 'character.scopes-changed'
          ? {
              userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
              characterId: 1404328063,
              addedScopes: ['esi-wallet.read_character_wallet.v1'],
              removedScopes: [],
            }
          : eventType === 'character.affiliation-observed'
            ? {
                userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
                characterId: 1404328063,
              }
            : storedEvent().payload,
    } as never

    await expect(
      dispatchDomainEvent(eventId, handlers, vi.fn().mockResolvedValue(event)),
    ).resolves.toBe(event)
    expect(repair).toHaveBeenCalledOnce()
    expect(repair).toHaveBeenCalledWith({ characterId: 1404328063 })
  })

  test.each([
    'character.attached',
    'character.detached',
    'character.scopes-changed',
    'character.affiliation-observed',
  ] as const)('recomputes account compliance for %s events', async (eventType) => {
    const recompute = vi.fn().mockResolvedValue(undefined)
    const handlers = createCharacterComplianceEventHandlers(recompute)
    const event = {
      ...storedEvent(),
      eventType,
      payload: {
        ...storedEvent().payload,
        ...(eventType === 'character.scopes-changed'
          ? { addedScopes: ['scope'], removedScopes: [] }
          : {}),
      },
    } as never

    await expect(
      dispatchDomainEvent(eventId, handlers, vi.fn().mockResolvedValue(event)),
    ).resolves.toBe(event)
    expect(recompute).toHaveBeenCalledWith('2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c')
  })

  test.each([
    'organization.managed-corporation-added',
    'organization.managed-corporation-removed',
  ] as const)('recomputes affected compliance for %s events', async (eventType) => {
    const recompute = vi.fn().mockResolvedValue(undefined)
    const handlers = createManagedCorporationComplianceEventHandlers(recompute)
    const event = {
      ...storedEvent(),
      eventType,
      aggregateType: 'deployment',
      aggregateId: '1',
      payload: { deploymentId: 1, organizationVersion: 4, corporationId: 98000001 },
    } as never

    await expect(
      dispatchDomainEvent(eventId, handlers, vi.fn().mockResolvedValue(event)),
    ).resolves.toBe(event)
    expect(recompute).toHaveBeenCalledOnce()
    expect(recompute).toHaveBeenCalledWith({
      deploymentId: 1,
      organizationVersion: 4,
      corporationId: 98000001,
    })
  })

  test('redelivers compliance events through convergent handlers', async () => {
    const recompute = vi.fn().mockResolvedValue({ outcome: 'unchanged' })
    const handlers = createCharacterComplianceEventHandlers(recompute)
    const event = {
      ...storedEvent(),
      eventType: 'character.affiliation-observed',
      payload: {
        userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        characterId: 1404328063,
      },
    } as never
    const loader = vi.fn().mockResolvedValue(event)

    await dispatchDomainEvent(eventId, handlers, loader)
    await dispatchDomainEvent(eventId, handlers, loader)

    expect(recompute).toHaveBeenCalledTimes(2)
    expect(handlers.every(({ idempotency }) => idempotency === 'convergent-state')).toBe(true)
  })
})

function handler(idempotency: DomainEventHandler['idempotency']): DomainEventHandler {
  return {
    eventType: 'character.attached',
    payloadVersion: 1,
    idempotency,
    handle: vi.fn(),
  }
}

function storedEvent() {
  return {
    eventId,
    eventSequence: 1n,
    eventType: 'character.attached' as const,
    payloadVersion: 1 as const,
    aggregateType: 'character' as const,
    aggregateId: '1404328063',
    payload: {
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      characterId: 1404328063,
      characterName: 'Bandera Primary',
      corporationId: 1000166,
      allianceId: null,
      isMain: true,
      scopes: [],
    },
    occurredAt: new Date('2026-08-23T12:00:00.000Z'),
  }
}
