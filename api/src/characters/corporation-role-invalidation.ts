import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characterCorporationRoleContents,
  characterCorporationRoleObservations,
  type CorporationRoleObservationInvalidationOutcome,
} from '../db/schema.js'

export const allocateCorporationRoleObservationSequence = async (
  database: DatabaseTransaction | typeof db = db,
) => {
  const [allocated] = await database.execute<{ sequence: string }>(
    sql`select nextval('character_corporation_role_observation_sequence')::text as sequence`,
  )
  if (!allocated) {
    throw new Error('Failed to allocate a corporation-role observation sequence')
  }
  return BigInt(allocated.sequence)
}

export const tombstoneCorporationRoleObservation = async (
  transaction: DatabaseTransaction,
  input: {
    readonly observationId: string
    readonly outcome: CorporationRoleObservationInvalidationOutcome
    readonly sequence: bigint
    readonly now: Date
  },
) => {
  await transaction
    .delete(characterCorporationRoleContents)
    .where(eq(characterCorporationRoleContents.observationId, input.observationId))
  const [row] = await transaction
    .update(characterCorporationRoleObservations)
    .set({
      degradedUntil: null,
      failureClass: `strict:${input.outcome}`,
      invalidatedAt: input.now,
      invalidationOutcome: input.outcome,
      lastAppliedObservationSequence: sql`greatest(${characterCorporationRoleObservations.lastAppliedObservationSequence}, ${input.sequence.toString()}::bigint)`,
      lastCheckedAt: input.now,
      nextRefreshAt: null,
      roleRevision: sql`coalesce(${characterCorporationRoleObservations.roleRevision}, gen_random_uuid())`,
      status: 'invalid',
      updatedAt: input.now,
    })
    .where(eq(characterCorporationRoleObservations.observationId, input.observationId))
    .returning()
  return row ?? null
}

export const invalidateCharacterCorporationRoleObservationsInTransaction = async (
  transaction: DatabaseTransaction,
  input: {
    readonly characterId: number
    readonly outcome: CorporationRoleObservationInvalidationOutcome
    readonly organizationVersion?: number
    readonly now?: Date
  },
) => {
  const now = input.now ?? new Date()
  const rows = await transaction
    .select({ observationId: characterCorporationRoleObservations.observationId })
    .from(characterCorporationRoleObservations)
    .where(
      and(
        eq(characterCorporationRoleObservations.characterId, input.characterId),
        ne(characterCorporationRoleObservations.status, 'invalid'),
        input.organizationVersion === undefined
          ? undefined
          : eq(characterCorporationRoleObservations.organizationVersion, input.organizationVersion),
      ),
    )
    .for('update')
  if (rows.length === 0) {
    return
  }
  const sequence = await allocateCorporationRoleObservationSequence(transaction)
  for (const { observationId } of rows) {
    // oxlint-disable-next-line no-await-in-loop -- rows are tombstoned in stable lock order.
    await tombstoneCorporationRoleObservation(transaction, {
      now,
      observationId,
      outcome: input.outcome,
      sequence,
    })
  }
}

export const invalidateOrganizationCorporationRoleObservationsInTransaction = async (
  transaction: DatabaseTransaction,
  input: { readonly organizationVersion: number; readonly now?: Date },
) => {
  const now = input.now ?? new Date()
  const rows = await transaction
    .select({ observationId: characterCorporationRoleObservations.observationId })
    .from(characterCorporationRoleObservations)
    .where(
      and(
        eq(characterCorporationRoleObservations.organizationVersion, input.organizationVersion),
        ne(characterCorporationRoleObservations.status, 'invalid'),
      ),
    )
    .orderBy(characterCorporationRoleObservations.observationId)
    .for('update')
  if (rows.length === 0) {
    return
  }
  const observationIds = rows.map(({ observationId }) => observationId)
  const sequence = await allocateCorporationRoleObservationSequence(transaction)
  await transaction
    .delete(characterCorporationRoleContents)
    .where(inArray(characterCorporationRoleContents.observationId, observationIds))
  await transaction
    .update(characterCorporationRoleObservations)
    .set({
      degradedUntil: null,
      failureClass: 'strict:organization-replaced',
      invalidatedAt: now,
      invalidationOutcome: 'organization-replaced',
      lastAppliedObservationSequence: sql`greatest(${characterCorporationRoleObservations.lastAppliedObservationSequence}, ${sequence.toString()}::bigint)`,
      nextRefreshAt: null,
      roleRevision: sql`coalesce(${characterCorporationRoleObservations.roleRevision}, gen_random_uuid())`,
      status: 'invalid',
      updatedAt: now,
    })
    .where(inArray(characterCorporationRoleObservations.observationId, observationIds))
}

export const advanceCharacterCorporationRoleObservationGenerationInTransaction = async (
  transaction: DatabaseTransaction,
  input: {
    readonly characterId: number
    readonly authorizationGeneration: number
    readonly now?: Date
  },
) => {
  await transaction
    .update(characterCorporationRoleObservations)
    .set({
      authorizationGeneration: input.authorizationGeneration,
      updatedAt: input.now ?? new Date(),
    })
    .where(
      and(
        eq(characterCorporationRoleObservations.characterId, input.characterId),
        ne(characterCorporationRoleObservations.status, 'invalid'),
      ),
    )
}
