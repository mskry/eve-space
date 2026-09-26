import { describe, expect, test, vi } from 'vitest'
import { validateStoredDomainEvent } from '../../src/domain-events/definitions.js'
import {
  createCharacterComplianceEventHandlers,
  createGroupRuleChangedHandler,
  createAllianceExecutorChangedHandler,
  createCorporationRoleAuthorityEventHandlers,
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
        { eventType: 'character.attached', handle: vi.fn(), payloadVersion: 1 },
      ]),
    ).toThrow('must declare an idempotency strategy')
    expect(() =>
      verifyDomainEventHandlers([
        {
          eventType: 'character.attached',
          handle: vi.fn(),
          idempotency: 'event-id-persistence',
          payloadVersion: 1,
        },
        {
          eventType: 'character.detached',
          handle: vi.fn(),
          idempotency: 'convergent-state',
          payloadVersion: 1,
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
              addedScopes: ['esi-wallet.read_character_wallet.v1'],
              characterId: 1_404_328_063,
              removedScopes: [],
              userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
            }
          : eventType === 'character.affiliation-observed'
            ? {
                characterId: 1_404_328_063,
                userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
              }
            : storedEvent().payload,
    } as never

    await expect(
      dispatchDomainEvent(eventId, handlers, vi.fn().mockResolvedValue(event)),
    ).resolves.toBe(event)
    expect(repair).toHaveBeenCalledOnce()
    expect(repair).toHaveBeenCalledWith({ characterId: 1_404_328_063 })
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
        ...(eventType === 'character.scopes-changed' && {
          addedScopes: ['scope'],
          removedScopes: [],
        }),
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
      aggregateId: '1',
      aggregateType: 'deployment',
      eventType,
      payload: { corporationId: 98_000_001, deploymentId: 1, organizationVersion: 4 },
    } as never

    await expect(
      dispatchDomainEvent(eventId, handlers, vi.fn().mockResolvedValue(event)),
    ).resolves.toBe(event)
    expect(recompute).toHaveBeenCalledOnce()
    expect(recompute).toHaveBeenCalledWith({
      corporationId: 98_000_001,
      deploymentId: 1,
      organizationVersion: 4,
    })
  })

  test.each([
    'character.corporation-roles-changed',
    'character.corporation-role-loss-confirmed',
  ] as const)(
    'repairs role-dependent authority from current evidence for %s events',
    async (eventType) => {
      const repair = vi.fn().mockResolvedValue(undefined)
      const handlers = createCorporationRoleAuthorityEventHandlers(repair)
      const event = { ...storedEvent(), eventType, payload: roleTransitionPayload() } as never
      const loader = vi.fn().mockResolvedValue(event)

      await dispatchDomainEvent(eventId, handlers, loader)
      await dispatchDomainEvent(eventId, handlers, loader)

      expect(repair).toHaveBeenCalledTimes(2)
      expect(repair).toHaveBeenLastCalledWith({
        characterId: 1_404_328_063,
        organizationVersion: 4,
        userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      })
      expect(handlers.every(({ idempotency }) => idempotency === 'convergent-state')).toBe(true)
    },
  )

  test('recomputes compliance and collection state after confirmed role loss', async () => {
    const recompute = vi.fn().mockResolvedValue(undefined)
    const repairCollection = vi.fn().mockResolvedValue(undefined)
    const event = {
      ...storedEvent(),
      eventType: 'character.corporation-role-loss-confirmed',
      payload: roleTransitionPayload(),
    } as never
    const loader = vi.fn().mockResolvedValue(event)

    await dispatchDomainEvent(
      eventId,
      [
        ...createCharacterComplianceEventHandlers(recompute),
        ...createPlatformCollectionStateEventHandlers(repairCollection),
      ],
      loader,
    )

    expect(recompute).toHaveBeenCalledWith('2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c')
    expect(repairCollection).toHaveBeenCalledWith({ characterId: 1_404_328_063 })
  })

  test('redelivers compliance events through convergent handlers', async () => {
    const recompute = vi.fn().mockResolvedValue({ outcome: 'unchanged' })
    const handlers = createCharacterComplianceEventHandlers(recompute)
    const event = {
      ...storedEvent(),
      eventType: 'character.affiliation-observed',
      payload: {
        characterId: 1_404_328_063,
        userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      },
    } as never
    const loader = vi.fn().mockResolvedValue(event)

    await dispatchDomainEvent(eventId, handlers, loader)
    await dispatchDomainEvent(eventId, handlers, loader)

    expect(recompute).toHaveBeenCalledTimes(2)
    expect(handlers.every(({ idempotency }) => idempotency === 'convergent-state')).toBe(true)
  })

  test('replays rule and executor events from current state with stable identities', async () => {
    const repairRule = vi.fn().mockResolvedValue(undefined)
    const ruleHandler = createGroupRuleChangedHandler(repairRule)
    const ruleEvent = validateStoredDomainEvent({
      ...storedEvent(),
      aggregateId: '1',
      aggregateType: 'deployment',
      eventType: 'organization.group-rule-changed',
      payload: { groupId: eventId, organizationVersion: 4, revision: 2 },
    })
    const loader = vi.fn().mockResolvedValue(ruleEvent)
    await dispatchDomainEvent(eventId, [ruleHandler], loader)
    await dispatchDomainEvent(eventId, [ruleHandler], loader)
    expect(repairRule).toHaveBeenCalledTimes(2)
    expect(repairRule).toHaveBeenLastCalledWith({
      groupId: eventId,
      organizationVersion: 4,
      revision: 2,
      signal: undefined,
    })

    const repairExecutor = vi.fn().mockResolvedValue(undefined)
    const executorHandler = createAllianceExecutorChangedHandler(repairExecutor)
    const executorEvent = validateStoredDomainEvent({
      ...storedEvent(),
      aggregateId: '1',
      aggregateType: 'deployment',
      eventType: 'organization.alliance-executor-changed',
      payload: { organizationVersion: 4, executorRevision: eventId },
    })
    await dispatchDomainEvent(eventId, [executorHandler], vi.fn().mockResolvedValue(executorEvent))
    expect(repairExecutor).toHaveBeenCalledWith({
      organizationVersion: 4,
      executorRevision: eventId,
      signal: undefined,
    })
  })
})

function handler(idempotency: DomainEventHandler['idempotency']): DomainEventHandler {
  return {
    eventType: 'character.attached',
    handle: vi.fn(),
    idempotency,
    payloadVersion: 1,
  }
}

function storedEvent() {
  return {
    aggregateId: '1404328063',
    aggregateType: 'character' as const,
    eventId,
    eventSequence: 1n,
    eventType: 'character.attached' as const,
    occurredAt: new Date('2026-08-23T12:00:00.000Z'),
    payload: {
      characterId: 1_404_328_063,
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    },
    payloadVersion: 1 as const,
  }
}

function roleTransitionPayload() {
  return {
    affiliationPeriodRevision: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
    authorityCorporationId: 98_000_001,
    authorizationGeneration: 7,
    characterId: 1_404_328_063,
    currentRoleRevision: '6f4a6f1e-3b1b-4f2f-9b41-6a6c1a7d9c55',
    organizationVersion: 4,
    previousRoleRevision: '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6',
    subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
    userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
  }
}
