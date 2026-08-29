import { z } from 'zod'

const positiveIdentifier = z.number().int().positive()
const scope = z.string().trim().min(1)
const scopeSet = z.array(scope).transform(normalizeScopeSet)

const characterSnapshot = {
  userId: z.uuid(),
  characterId: positiveIdentifier,
  characterName: z.string().trim().min(1),
  corporationId: positiveIdentifier,
  allianceId: positiveIdentifier.nullable(),
  isMain: z.boolean(),
  scopes: scopeSet,
}

const characterAttachedPayloadSchema = z.object(characterSnapshot).strict()
const characterDetachedPayloadSchema = z.object(characterSnapshot).strict()
const characterMainChangedPayloadSchema = z
  .object({
    userId: z.uuid(),
    previousMainCharacterId: positiveIdentifier,
    newMainCharacterId: positiveIdentifier,
  })
  .strict()
  .refine((payload) => payload.previousMainCharacterId !== payload.newMainCharacterId, {
    message: 'Previous and new main characters must differ',
  })
const characterScopesChangedPayloadSchema = z
  .object({
    userId: z.uuid(),
    characterId: positiveIdentifier,
    addedScopes: scopeSet,
    removedScopes: scopeSet,
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.addedScopes.length === 0 && payload.removedScopes.length === 0) {
      context.addIssue({ code: 'custom', message: 'At least one scope must have changed' })
    }
    const removed = new Set(payload.removedScopes)
    if (payload.addedScopes.some((item) => removed.has(item))) {
      context.addIssue({ code: 'custom', message: 'Added and removed scopes must not overlap' })
    }
  })

export type DomainEventAggregateType = 'character' | 'user'

const domainEventRegistry = {
  'character.attached': {
    aggregateType: 'character',
    versions: { 1: characterAttachedPayloadSchema },
  },
  'character.detached': {
    aggregateType: 'character',
    versions: { 1: characterDetachedPayloadSchema },
  },
  'character.main-changed': {
    aggregateType: 'user',
    versions: { 1: characterMainChangedPayloadSchema },
  },
  'character.scopes-changed': {
    aggregateType: 'character',
    versions: { 1: characterScopesChangedPayloadSchema },
  },
} as const

type DomainEventRegistry = typeof domainEventRegistry
export type DomainEventType = keyof DomainEventRegistry
type DomainEventVersion<Type extends DomainEventType> =
  keyof DomainEventRegistry[Type]['versions'] & number
type PayloadSchema<
  Type extends DomainEventType,
  Version extends DomainEventVersion<Type>,
> = DomainEventRegistry[Type]['versions'][Version] & z.ZodType

export type DomainEventPayload = {
  [Type in DomainEventType]: z.output<PayloadSchema<Type, DomainEventVersion<Type>>>
}[DomainEventType]

export type RegisteredDomainEventInput = {
  [Type in DomainEventType]: {
    [Version in DomainEventVersion<Type>]: {
      type: Type
      payloadVersion: Version
      aggregateId: string
      payload: z.input<PayloadSchema<Type, Version>>
      occurredAt?: Date
    }
  }[DomainEventVersion<Type>]
}[DomainEventType]

export type ValidatedDomainEventInput = {
  [Type in DomainEventType]: {
    [Version in DomainEventVersion<Type>]: {
      type: Type
      payloadVersion: Version
      aggregateType: DomainEventRegistry[Type]['aggregateType']
      aggregateId: string
      payload: z.output<PayloadSchema<Type, Version>>
      occurredAt?: Date
    }
  }[DomainEventVersion<Type>]
}[DomainEventType]

interface StoredEnvelopeFields {
  eventId: string
  eventSequence: bigint
  aggregateId: string
  occurredAt: Date
}

export type DomainEventEnvelope = {
  [Type in DomainEventType]: {
    [Version in DomainEventVersion<Type>]: StoredEnvelopeFields & {
      eventType: Type
      payloadVersion: Version
      aggregateType: DomainEventRegistry[Type]['aggregateType']
      payload: z.output<PayloadSchema<Type, Version>>
    }
  }[DomainEventVersion<Type>]
}[DomainEventType]

export const relayFailureCategories = [
  'queue-unavailable',
  'queue-rejected',
  'invalid-event',
  'unknown',
] as const
export type RelayFailureCategory = (typeof relayFailureCategories)[number]

export class DomainEventValidationError extends Error {
  constructor(message = 'Domain event validation failed') {
    super(message)
  }
}

export class RelayPublicationError extends Error {
  constructor(readonly category: RelayFailureCategory) {
    super('Domain event publication failed')
  }
}

const eventInputEnvelope = z
  .object({
    type: z.string(),
    payloadVersion: z.number().int().positive(),
    aggregateId: z.string().trim().min(1).max(255),
    payload: z.unknown(),
    occurredAt: z.date().optional(),
  })
  .strict()

const storedEnvelope = z
  .object({
    eventId: z.uuid(),
    eventSequence: z.bigint().positive(),
    eventType: z.string(),
    payloadVersion: z.number().int().positive(),
    aggregateType: z.string(),
    aggregateId: z.string().min(1),
    payload: z.unknown(),
    occurredAt: z.date(),
  })
  .strict()

export function normalizeScopeSet(scopes: readonly string[]) {
  return [...new Set(scopes)].toSorted((left, right) => left.localeCompare(right))
}

export function listDomainEventDefinitions() {
  return Object.entries(domainEventRegistry).flatMap(([type, definition]) =>
    Object.keys(definition.versions).map((version) => ({
      type: type as DomainEventType,
      payloadVersion: Number(version),
      aggregateType: definition.aggregateType,
    })),
  )
}

export function validateDomainEventInput(input: unknown): ValidatedDomainEventInput {
  const envelope = parseSafely(eventInputEnvelope, input)
  assertSecretFreePayload(envelope.payload)
  const definition = getDomainEventDefinition(envelope.type, envelope.payloadVersion)
  const payload = parseSafely(definition.payloadSchema, envelope.payload)
  return {
    ...envelope,
    type: envelope.type,
    aggregateType: definition.aggregateType,
    payload,
  } as ValidatedDomainEventInput
}

export function validateStoredDomainEvent(input: unknown): DomainEventEnvelope {
  const envelope = parseSafely(storedEnvelope, input)
  assertSecretFreePayload(envelope.payload)
  const definition = getDomainEventDefinition(envelope.eventType, envelope.payloadVersion)
  if (envelope.aggregateType !== definition.aggregateType) throw new DomainEventValidationError()
  const payload = parseSafely(definition.payloadSchema, envelope.payload)
  return { ...envelope, payload } as DomainEventEnvelope
}

export function assertSecretFreePayload(payload: unknown) {
  const visited = new WeakSet<object>()

  function inspect(value: unknown, key?: string) {
    if (key && containsSensitiveMarker(key)) throw new DomainEventValidationError()
    if (typeof value !== 'object' || value === null || visited.has(value)) return

    visited.add(value)
    if (Array.isArray(value)) {
      for (const item of value) inspect(item)
      return
    }
    for (const [childKey, childValue] of Object.entries(value)) inspect(childValue, childKey)
  }

  inspect(payload)
}

export function categorizeRelayFailure(error: unknown): RelayFailureCategory {
  if (error instanceof RelayPublicationError) return error.category
  if (error instanceof DomainEventValidationError) return 'invalid-event'
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)
  )
    return 'queue-unavailable'
  return 'unknown'
}

function getDomainEventDefinition(type: string, version: number) {
  const definition = (
    domainEventRegistry as Record<
      string,
      { aggregateType: DomainEventAggregateType; versions: Record<number, z.ZodType> }
    >
  )[type]
  const payloadSchema = definition?.versions[version]
  if (!definition || !payloadSchema) throw new DomainEventValidationError()
  return { aggregateType: definition.aggregateType, payloadSchema }
}

function parseSafely<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input)
  if (!result.success) throw new DomainEventValidationError()
  return result.data
}

function containsSensitiveMarker(value: string) {
  const normalized = value.replaceAll(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  return /(?:access[_ -]?token|refresh[_ -]?token|bearer|credential|password|session|secret|encryption|ciphertext|private[_ -]?key)/.test(
    normalized,
  )
}
