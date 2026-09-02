import { loadDomainEvent } from './store.js'
import type { DomainEventEnvelope, DomainEventType } from './definitions.js'
import {
  recomputeComplianceForManagedCorporation,
  recomputeCurrentOrganizationAccountCompliance,
} from '../organization/compliance.js'
import { repairPlatformCollectionState } from '../platform/collection-state-repair.js'

const domainEventIdempotencyStrategies = ['event-id-persistence', 'convergent-state'] as const

type DomainEventIdempotencyStrategy = (typeof domainEventIdempotencyStrategies)[number]

export interface DomainEventHandler {
  eventType: DomainEventType
  payloadVersion: number
  idempotency: DomainEventIdempotencyStrategy
  handle(event: DomainEventEnvelope): Promise<void>
}

export class DomainEventNotFoundError extends Error {
  constructor() {
    super('Domain event was not found')
  }
}

type CharacterCollectionStateRepair = (options: { characterId: number }) => Promise<unknown>

const characterCollectionStateEventTypes = [
  'character.attached',
  'character.detached',
  'character.scopes-changed',
  'character.affiliation-observed',
] as const

type CharacterCollectionStateEvent = Extract<
  DomainEventEnvelope,
  { eventType: (typeof characterCollectionStateEventTypes)[number] }
>

/**
 * `dispatchDomainEvent` only ever routes an event to a handler declaring its type, but `handle`
 * receives the whole envelope union, so the narrowing has to be re-established here.
 */
function isCharacterCollectionStateEvent(
  event: DomainEventEnvelope,
): event is CharacterCollectionStateEvent {
  return (characterCollectionStateEventTypes as readonly DomainEventType[]).includes(
    event.eventType,
  )
}

export function createPlatformCollectionStateEventHandlers(
  repair: CharacterCollectionStateRepair = repairPlatformCollectionState,
): readonly DomainEventHandler[] {
  return characterCollectionStateEventTypes.map((eventType) => ({
    eventType,
    payloadVersion: 1,
    idempotency: 'convergent-state',
    async handle(event) {
      if (!isCharacterCollectionStateEvent(event)) return
      await repair({ characterId: event.payload.characterId })
    },
  }))
}

type ManagedCorporationComplianceRecompute = typeof recomputeComplianceForManagedCorporation
const managedCorporationEventTypes = [
  'organization.managed-corporation-added',
  'organization.managed-corporation-removed',
] as const
type ManagedCorporationEvent = Extract<
  DomainEventEnvelope,
  { eventType: (typeof managedCorporationEventTypes)[number] }
>

function isManagedCorporationEvent(event: DomainEventEnvelope): event is ManagedCorporationEvent {
  return (managedCorporationEventTypes as readonly DomainEventType[]).includes(event.eventType)
}

export function createManagedCorporationComplianceEventHandlers(
  recompute: ManagedCorporationComplianceRecompute = recomputeComplianceForManagedCorporation,
): readonly DomainEventHandler[] {
  return managedCorporationEventTypes.map((eventType) => ({
    eventType,
    payloadVersion: 1,
    idempotency: 'convergent-state',
    async handle(event) {
      if (!isManagedCorporationEvent(event)) return
      await recompute(event.payload)
    },
  }))
}

type CharacterComplianceRecompute = typeof recomputeCurrentOrganizationAccountCompliance
const characterComplianceEventTypes = [
  'character.attached',
  'character.detached',
  'character.scopes-changed',
  'character.affiliation-observed',
] as const
type CharacterComplianceEvent = Extract<
  DomainEventEnvelope,
  { eventType: (typeof characterComplianceEventTypes)[number] }
>

function isCharacterComplianceEvent(event: DomainEventEnvelope): event is CharacterComplianceEvent {
  return (characterComplianceEventTypes as readonly DomainEventType[]).includes(event.eventType)
}

export function createCharacterComplianceEventHandlers(
  recompute: CharacterComplianceRecompute = recomputeCurrentOrganizationAccountCompliance,
): readonly DomainEventHandler[] {
  return characterComplianceEventTypes.map((eventType) => ({
    eventType,
    payloadVersion: 1,
    idempotency: 'convergent-state',
    async handle(event) {
      if (!isCharacterComplianceEvent(event)) return
      await recompute(event.payload.userId)
    },
  }))
}

const domainEventHandlers = [
  ...createPlatformCollectionStateEventHandlers(),
  ...createCharacterComplianceEventHandlers(),
  ...createManagedCorporationComplianceEventHandlers(),
]

export function verifyDomainEventHandlers(
  handlers: readonly Partial<DomainEventHandler>[] = domainEventHandlers,
) {
  for (const handler of handlers) {
    if (!domainEventIdempotencyStrategies.includes(handler.idempotency as never)) {
      throw new Error(
        `Domain event handler ${handler.eventType ?? 'unknown'} must declare an idempotency strategy`,
      )
    }
  }
}

export async function dispatchDomainEvent(
  eventId: string,
  handlers: readonly DomainEventHandler[] = domainEventHandlers,
  loader: typeof loadDomainEvent = loadDomainEvent,
) {
  verifyDomainEventHandlers(handlers)
  const event = await loader(eventId)
  if (!event) throw new DomainEventNotFoundError()

  await Promise.all(
    handlers
      .filter(
        (handler) =>
          handler.eventType === event.eventType && handler.payloadVersion === event.payloadVersion,
      )
      .map((handler) => handler.handle(event)),
  )
  return event
}
