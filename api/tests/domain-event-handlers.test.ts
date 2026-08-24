import { describe, expect, test, vi } from 'vitest'
import {
  dispatchDomainEvent,
  DomainEventNotFoundError,
  verifyDomainEventHandlers,
  type DomainEventHandler,
} from '../src/domain-event-handlers.js'

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
