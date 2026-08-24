import { loadDomainEvent } from './domain-event-store.js'
import type { DomainEventEnvelope, DomainEventType } from './domain-events.js'

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

const domainEventHandlers: readonly DomainEventHandler[] = []

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
