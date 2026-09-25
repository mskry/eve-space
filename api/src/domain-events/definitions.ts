import { z } from 'zod'
import { normalizeScopeSet } from '../scopes.js'

const positiveIdentifier = z.number().int().positive()
const scope = z.string().trim().min(1)
const scopeSet = z.array(scope).transform(normalizeScopeSet)

const characterLifecyclePayloadSchema = z
  .object({ characterId: positiveIdentifier, userId: z.uuid() })
  .strict()
const characterMainChangedPayloadSchema = z
  .object({
    newMainCharacterId: positiveIdentifier,
    previousMainCharacterId: positiveIdentifier,
    userId: z.uuid(),
  })
  .strict()
  .refine((payload) => payload.previousMainCharacterId !== payload.newMainCharacterId, {
    message: 'Previous and new main characters must differ',
  })
const characterScopesChangedPayloadSchema = z
  .object({
    addedScopes: scopeSet,
    characterId: positiveIdentifier,
    removedScopes: scopeSet,
    userId: z.uuid(),
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

const characterAffiliationObservedPayloadSchema = z
  .object({ characterId: positiveIdentifier, userId: z.uuid() })
  .strict()

const characterCorporationRoleTransitionPayloadSchema = z
  .object({
    affiliationPeriodRevision: z.uuid(),
    authorityCorporationId: positiveIdentifier,
    authorizationGeneration: z.number().int().nonnegative(),
    characterId: positiveIdentifier,
    currentRoleRevision: z.uuid(),
    organizationVersion: positiveIdentifier,
    previousRoleRevision: z.uuid(),
    subjectLifecycleId: z.uuid(),
    userId: z.uuid(),
  })
  .strict()
  .refine((payload) => payload.previousRoleRevision !== payload.currentRoleRevision, {
    message: 'Previous and current role revisions must differ',
  })

const organizationChangedPayloadSchema = z
  .object({
    actorAdminId: z.uuid(),
    organizationId: positiveIdentifier,
    organizationType: z.enum(['corporation', 'alliance']),
    organizationVersion: positiveIdentifier,
    previousOrganizationId: positiveIdentifier,
    previousOrganizationType: z.enum(['corporation', 'alliance']),
    previousOrganizationVersion: positiveIdentifier,
  })
  .strict()
  .refine(
    (payload) =>
      payload.previousOrganizationType !== payload.organizationType ||
      payload.previousOrganizationId !== payload.organizationId,
    { message: 'Previous and new organizations must differ' },
  )
  .refine((payload) => payload.organizationVersion === payload.previousOrganizationVersion + 1, {
    message: 'Organization version must advance exactly once',
  })

const organizationMemberBlockPayloadSchema = z
  .object({
    blockId: z.uuid(),
    organizationVersion: positiveIdentifier,
    userId: z.uuid(),
  })
  .strict()

const managedCorporationPayloadSchema = z
  .object({
    corporationId: positiveIdentifier,
    deploymentId: z.literal(1),
    organizationVersion: positiveIdentifier,
  })
  .strict()

const complianceTransitionPayloadSchema = z
  .object({
    deploymentId: z.literal(1),
    evidenceFreshness: z.enum(['fresh', 'stale', 'unavailable']),
    organizationVersion: positiveIdentifier,
    state: z.enum(['pending', 'compliant', 'review_required', 'suspended']),
    userId: z.uuid(),
  })
  .strict()

export type DomainEventAggregateType = 'character' | 'user' | 'deployment'

const domainEventRegistry = {
  'character.attached': {
    aggregateType: 'character',
    versions: { 1: characterLifecyclePayloadSchema },
  },
  'character.detached': {
    aggregateType: 'character',
    versions: { 1: characterLifecyclePayloadSchema },
  },
  'character.main-changed': {
    aggregateType: 'user',
    versions: { 1: characterMainChangedPayloadSchema },
  },
  'character.scopes-changed': {
    aggregateType: 'character',
    versions: { 1: characterScopesChangedPayloadSchema },
  },
  'character.affiliation-observed': {
    aggregateType: 'character',
    versions: { 1: characterAffiliationObservedPayloadSchema },
  },
  'character.corporation-roles-changed': {
    aggregateType: 'character',
    versions: { 1: characterCorporationRoleTransitionPayloadSchema },
  },
  'character.corporation-role-loss-confirmed': {
    aggregateType: 'character',
    versions: { 1: characterCorporationRoleTransitionPayloadSchema },
  },
  'organization.changed': {
    aggregateType: 'deployment',
    versions: { 1: organizationChangedPayloadSchema },
  },
  'organization.member-blocked': {
    aggregateType: 'user',
    versions: { 1: organizationMemberBlockPayloadSchema },
  },
  'organization.member-unblocked': {
    aggregateType: 'user',
    versions: { 1: organizationMemberBlockPayloadSchema },
  },
  'organization.managed-corporation-added': {
    aggregateType: 'deployment',
    versions: { 1: managedCorporationPayloadSchema },
  },
  'organization.managed-corporation-removed': {
    aggregateType: 'deployment',
    versions: { 1: managedCorporationPayloadSchema },
  },
  'organization.compliance-transitioned': {
    aggregateType: 'user',
    versions: { 1: complianceTransitionPayloadSchema },
  },
} as const

const domainEventDefinitionsByType = new Map(Object.entries(domainEventRegistry))

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
    aggregateId: z.string().trim().min(1).max(255),
    occurredAt: z.date().optional(),
    payload: z.unknown(),
    payloadVersion: z.number().int().positive(),
    type: z.string(),
  })
  .strict()

const storedEnvelope = z
  .object({
    aggregateId: z.string().min(1),
    aggregateType: z.string(),
    eventId: z.uuid(),
    eventSequence: z.bigint().positive(),
    eventType: z.string(),
    occurredAt: z.date(),
    payload: z.unknown(),
    payloadVersion: z.number().int().positive(),
  })
  .strict()

export function listDomainEventDefinitions() {
  return Object.entries(domainEventRegistry).flatMap(([type, definition]) =>
    Object.keys(definition.versions).map((version) => ({
      aggregateType: definition.aggregateType,
      payloadVersion: Number(version),
      type: type as DomainEventType,
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
    aggregateType: definition.aggregateType,
    payload,
    type: envelope.type,
  } as ValidatedDomainEventInput
}

export function validateStoredDomainEvent(input: unknown): DomainEventEnvelope {
  const envelope = parseSafely(storedEnvelope, input)
  assertSecretFreePayload(envelope.payload)
  const definition = getDomainEventDefinition(envelope.eventType, envelope.payloadVersion)
  if (envelope.aggregateType !== definition.aggregateType) {
    throw new DomainEventValidationError()
  }
  const payload = parseSafely(definition.payloadSchema, envelope.payload)
  return { ...envelope, payload } as DomainEventEnvelope
}

export function assertSecretFreePayload(payload: unknown) {
  const visited = new WeakSet<object>()

  function inspect(value: unknown, key?: string) {
    if (key && containsSensitiveMarker(key)) {
      throw new DomainEventValidationError()
    }
    if (typeof value !== 'object' || value === null || visited.has(value)) {
      return
    }

    visited.add(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        inspect(item)
      }
      return
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      inspect(childValue, childKey)
    }
  }

  inspect(payload)
}

export function categorizeRelayFailure(error: unknown): RelayFailureCategory {
  if (error instanceof RelayPublicationError) {
    return error.category
  }
  if (error instanceof DomainEventValidationError) {
    return 'invalid-event'
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)
  ) {
    return 'queue-unavailable'
  }
  return 'unknown'
}

function getDomainEventDefinition(type: string, version: number) {
  const definition = domainEventDefinitionsByType.get(type)
  const payloadSchema =
    definition &&
    Object.entries(definition.versions).find(
      ([candidateVersion]) => Number(candidateVersion) === version,
    )?.[1]
  if (!definition || !payloadSchema) {
    throw new DomainEventValidationError()
  }
  return { aggregateType: definition.aggregateType, payloadSchema }
}

function parseSafely<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new DomainEventValidationError()
  }
  return result.data
}

function containsSensitiveMarker(value: string) {
  const normalized = value.replaceAll(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  return /(?:access[_ -]?token|refresh[_ -]?token|bearer|credential|password|session|secret|encryption|ciphertext|private[_ -]?key)/.test(
    normalized,
  )
}
