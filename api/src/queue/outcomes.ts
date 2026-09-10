import { z } from 'zod'

const recordedAt = z.iso.datetime({ offset: true })

const outboxRelayOutcomeSchema = z
  .object({
    outcome: z.enum(['idle', 'published', 'partial-failure', 'failed', 'paused']),
    category: z
      .enum(['queue-unavailable', 'queue-rejected', 'invalid-event', 'unknown'])
      .nullable(),
    recordedAt,
  })
  .strict()
  .superRefine((value, context) => {
    const failed = value.outcome === 'failed' || value.outcome === 'partial-failure'
    if (failed === (value.category === null))
      context.addIssue({
        code: 'custom',
        message: 'Relay failure outcomes and categories must correspond',
      })
  })

const affiliationPlannerOutcomeSchema = z
  .object({
    outcome: z.enum(['scheduled', 'idle', 'cooldown', 'paused', 'coalesced', 'failed']),
    planned: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    recordedAt,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      ((value.outcome === 'idle' || value.outcome === 'cooldown') && value.planned !== 0) ||
      (value.outcome === 'scheduled' && value.planned === 0)
    )
      context.addIssue({
        code: 'custom',
        message: 'Affiliation outcome and planned count must correspond',
      })
  })

export type OutboxRelayOutcome = z.infer<typeof outboxRelayOutcomeSchema>
export type AffiliationPlannerOutcome = z.infer<typeof affiliationPlannerOutcomeSchema>

export function encodeOutboxRelayOutcome(outcome: OutboxRelayOutcome) {
  return JSON.stringify(outboxRelayOutcomeSchema.parse(outcome))
}

export function decodeOutboxRelayOutcome(value: string | null) {
  return decodeOutcome(value, outboxRelayOutcomeSchema)
}

export function encodeAffiliationPlannerOutcome(outcome: AffiliationPlannerOutcome) {
  return JSON.stringify(affiliationPlannerOutcomeSchema.parse(outcome))
}

export function decodeAffiliationPlannerOutcome(value: string | null) {
  return decodeOutcome(value, affiliationPlannerOutcomeSchema)
}

function decodeOutcome<Schema extends z.ZodType>(value: string | null, schema: Schema) {
  if (!value) return null
  try {
    const result = schema.safeParse(JSON.parse(value))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
