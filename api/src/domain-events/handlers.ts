import { loadDomainEvent } from './store.js'
import type { DomainEventEnvelope, DomainEventType } from './definitions.js'
import {
  recomputeComplianceForManagedCorporation,
  recomputeCurrentOrganizationAccountCompliance,
} from '../organization/compliance.js'
import { repairCorporationRoleDependentAuthority } from '../organization/corporation-role-convergence.js'
import { runRuleGroupReconciliation } from '../organization/group-rule-repair.js'
import { repairAllianceExecutorRuleGroups } from '../organization/alliance-executor-repair.js'
import { repairPlatformCollectionState } from '../platform/collection-state-repair.js'

const domainEventIdempotencyStrategies = ['event-id-persistence', 'convergent-state'] as const

type DomainEventIdempotencyStrategy = (typeof domainEventIdempotencyStrategies)[number]

export interface DomainEventHandler {
  eventType: DomainEventType
  payloadVersion: number
  idempotency: DomainEventIdempotencyStrategy
  handle(event: DomainEventEnvelope, signal?: AbortSignal): Promise<void>
}

export class DomainEventNotFoundError extends Error {
  constructor() {
    super('Domain event was not found')
  }
}

type CharacterCollectionStateRepair = (options: {
  characterId: number
  signal?: AbortSignal
}) => Promise<void>

const characterCollectionStateEventTypes = [
  'character.attached',
  'character.detached',
  'character.scopes-changed',
  'character.affiliation-observed',
  'character.corporation-roles-changed',
  'character.corporation-role-loss-confirmed',
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
  repair: CharacterCollectionStateRepair = async (options) => {
    await repairPlatformCollectionState(options)
  },
): readonly DomainEventHandler[] {
  return characterCollectionStateEventTypes.map((eventType) => ({
    eventType,
    async handle(event, signal) {
      if (!isCharacterCollectionStateEvent(event)) {
        return
      }
      await repair({
        characterId: event.payload.characterId,
        ...(signal && { signal }),
      })
    },
    idempotency: 'convergent-state',
    payloadVersion: 1,
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
    async handle(event, signal) {
      if (!isManagedCorporationEvent(event)) {
        return
      }
      signal?.throwIfAborted()
      await recompute(event.payload)
    },
    idempotency: 'convergent-state',
    payloadVersion: 1,
  }))
}

type CharacterComplianceRecompute = typeof recomputeCurrentOrganizationAccountCompliance
const characterComplianceEventTypes = [
  'character.attached',
  'character.detached',
  'character.scopes-changed',
  'character.affiliation-observed',
  'character.corporation-roles-changed',
  'character.corporation-role-loss-confirmed',
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
    async handle(event, signal) {
      if (!isCharacterComplianceEvent(event)) {
        return
      }
      signal?.throwIfAborted()
      await recompute(event.payload.userId)
    },
    idempotency: 'convergent-state',
    payloadVersion: 1,
  }))
}

type CorporationRoleAuthorityRepair = typeof repairCorporationRoleDependentAuthority
const corporationRoleEventTypes = [
  'character.corporation-roles-changed',
  'character.corporation-role-loss-confirmed',
] as const
const corporationRoleEventTypeValues: readonly DomainEventType[] = corporationRoleEventTypes
type CorporationRoleEvent = Extract<
  DomainEventEnvelope,
  { eventType: (typeof corporationRoleEventTypes)[number] }
>

function isCorporationRoleEvent(event: DomainEventEnvelope): event is CorporationRoleEvent {
  return corporationRoleEventTypeValues.includes(event.eventType)
}

export function createCorporationRoleAuthorityEventHandlers(
  repair: CorporationRoleAuthorityRepair = repairCorporationRoleDependentAuthority,
): readonly DomainEventHandler[] {
  return corporationRoleEventTypes.map((eventType) => ({
    eventType,
    async handle(event, signal) {
      if (!isCorporationRoleEvent(event)) {
        return
      }
      await repair({
        characterId: event.payload.characterId,
        organizationVersion: event.payload.organizationVersion,
        userId: event.payload.userId,
        ...(signal && { signal }),
      })
    },
    idempotency: 'convergent-state',
    payloadVersion: 1,
  }))
}

export const createGroupRuleChangedHandler = (
  repair: typeof runRuleGroupReconciliation = runRuleGroupReconciliation,
): DomainEventHandler => ({
  eventType: 'organization.group-rule-changed',
  payloadVersion: 1,
  idempotency: 'convergent-state',
  async handle(event: DomainEventEnvelope, signal?: AbortSignal) {
    if (event.eventType !== 'organization.group-rule-changed') {
      return
    }
    await repair({ ...event.payload, signal })
  },
})

export const createAllianceExecutorChangedHandler = (
  repair: typeof repairAllianceExecutorRuleGroups = repairAllianceExecutorRuleGroups,
): DomainEventHandler => ({
  eventType: 'organization.alliance-executor-changed',
  payloadVersion: 1,
  idempotency: 'convergent-state',
  async handle(event, signal) {
    if (event.eventType !== 'organization.alliance-executor-changed') {
      return
    }
    await repair({ ...event.payload, signal })
  },
})

const domainEventHandlers = [
  ...createCorporationRoleAuthorityEventHandlers(),
  ...createPlatformCollectionStateEventHandlers(),
  ...createCharacterComplianceEventHandlers(),
  ...createManagedCorporationComplianceEventHandlers(),
  createGroupRuleChangedHandler(),
  createAllianceExecutorChangedHandler(),
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
  signal?: AbortSignal,
) {
  verifyDomainEventHandlers(handlers)
  signal?.throwIfAborted()
  const event = await loader(eventId)
  signal?.throwIfAborted()
  if (!event) {
    throw new DomainEventNotFoundError()
  }

  await Promise.all(
    handlers
      .filter(
        (handler) =>
          handler.eventType === event.eventType && handler.payloadVersion === event.payloadVersion,
      )
      .map((handler) => (signal ? handler.handle(event, signal) : handler.handle(event))),
  )
  return event
}
