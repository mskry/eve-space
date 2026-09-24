import { operationRegistry } from '@evespace/esi-client/operations'
import { and, asc, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, type DatabaseTransaction } from '../db/client.js'
import { characterLockKey, characterLockNamespace } from '../db/locks.js'
import { characters } from '../db/schema.js'
import { env } from '../env.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { createPublicEsiRead } from '../esi-gateway/feature-execution.js'

const generatedAffiliationBatchLimit =
  operationRegistry.PostCharactersAffiliation.transport.protocol.maximumBatchSize
if (generatedAffiliationBatchLimit === null) {
  throw new Error('Bulk affiliation operation must declare a maximum batch size')
}
const affiliationBatchLimit = generatedAffiliationBatchLimit

const affiliationObservationCacheSchema = z.array(
  z.object({
    allianceId: z.number().nullable(),
    characterId: z.number(),
    corporationId: z.number(),
  }),
)

const bulkAffiliationRead = createPublicEsiRead({
  cacheSchema: affiliationObservationCacheSchema,
  descriptor: operationRegistry.PostCharactersAffiliation.transport,
  encodeRequest: (input: { body: number[]; signal?: AbortSignal }) => ({ body: input.body }),
  map: ({ data }): AffiliationObservation[] =>
    data.map((affiliation) => ({
      characterId: affiliation.character_id,
      corporationId: affiliation.corporation_id,
      allianceId: affiliation.alliance_id ?? null,
    })),
  name: 'bulk-affiliation-core',
  operation: 'bulk-affiliation',
})

interface AffiliationObservation {
  characterId: number
  corporationId: number
  allianceId: number | null
}

export type AffiliationPersistenceHook = (
  transaction: DatabaseTransaction,
  userIds: readonly string[],
  observedAt: Date,
) => Promise<void>

export async function observeCharacterAffiliation(characterId: number, signal?: AbortSignal) {
  const result = await lookupAffiliationResult([characterId], signal)
  const observation = result.data.find((entry) => entry.characterId === characterId)
  if (!observation) {
    return null
  }
  return {
    ...observation,
    affiliationCheckedAt: new Date(result.validatedAt),
    affiliationFreshUntil: new Date(result.cachedUntil),
    stale: result.stale,
  }
}

export async function observeAndPersistCharacterAffiliation(
  characterId: number,
  signal?: AbortSignal,
  afterPersist?: AffiliationPersistenceHook,
) {
  const observation = await observeCharacterAffiliation(characterId, signal)
  signal?.throwIfAborted()
  if (observation && !observation.stale) {
    await persistAffiliationObservations(
      [characterId],
      [observation],
      observation.affiliationCheckedAt,
      signal,
      afterPersist,
    )
  }
  return observation
}

export async function selectDueAffiliationBatches(now = new Date()) {
  const due = await db
    .select({ characterId: characters.characterId })
    .from(characters)
    .where(and(lte(characters.nextAffiliationCheck, now)))
    .orderBy(asc(characters.nextAffiliationCheck), asc(characters.characterId))
    .limit(affiliationBatchLimit)
  if (due.length === 0) {
    return []
  }
  return [due.map(({ characterId }) => characterId).toSorted((left, right) => left - right)]
}

export async function processAffiliationBatch(
  characterIds: readonly number[],
  signal?: AbortSignal,
  afterPersist?: AffiliationPersistenceHook,
) {
  const batch = validateAffiliationBatch(characterIds)
  signal?.throwIfAborted()
  const observedAt = new Date()
  const result = await lookupAffiliationResult(batch, signal)
  signal?.throwIfAborted()
  await persistAffiliationObservations(batch, result.data, observedAt, signal, afterPersist)
}

async function persistAffiliationObservations(
  requestedCharacterIds: readonly number[],
  observations: readonly AffiliationObservation[],
  observedAt: Date,
  signal?: AbortSignal,
  afterPersist?: AffiliationPersistenceHook,
) {
  signal?.throwIfAborted()
  const requested = new Set(requestedCharacterIds)
  const returned = new Map<number, AffiliationObservation>()
  for (const observation of observations) {
    if (requested.has(observation.characterId)) {
      returned.set(observation.characterId, observation)
    }
  }
  const omitted = requestedCharacterIds.filter((characterId) => !returned.has(characterId))
  const observedAtValue = observedAt.toISOString()
  const nextCheck = nextAffiliationCheckSql(observedAtValue)

  await db.transaction(async (transaction) => {
    const lockKeys = JSON.stringify(
      [...new Set([...requested].map((characterId) => characterLockKey(characterId)))].toSorted(
        (left, right) => left - right,
      ),
    )
    await transaction.execute(sql`
      select pg_advisory_xact_lock_shared(${characterLockNamespace}, lock_key)
      from (
        select value::integer as lock_key
        from jsonb_array_elements_text(${lockKeys}::jsonb)
        order by lock_key
      ) locks
    `)
    const affectedCharacters = await transaction
      .select({ characterId: characters.characterId, userId: characters.userId })
      .from(characters)
      .where(inArray(characters.characterId, [...requested]))
      .orderBy(asc(characters.userId), asc(characters.characterId))
    const affectedUserIds = [...new Set(affectedCharacters.map(({ userId }) => userId))]
    await afterPersist?.(transaction, affectedUserIds, observedAt)
    signal?.throwIfAborted()

    if (returned.size > 0) {
      const records = JSON.stringify(
        Array.from(returned.values(), (observation) => ({
          alliance_id: observation.allianceId,
          character_id: observation.characterId,
          corporation_id: observation.corporationId,
        })),
      )
      await transaction.execute(sql`
        with observations as (
          select character_id, corporation_id, alliance_id
          from jsonb_to_recordset(${records}::jsonb)
            as source(character_id bigint, corporation_id bigint, alliance_id bigint)
        )
        update characters as character
        set
          corporation_id = observations.corporation_id,
          alliance_id = observations.alliance_id,
          affiliation_checked_at = ${observedAtValue}::timestamptz,
          affiliation_resolution_state = 'resolved',
          next_affiliation_check = ${nextCheck},
          updated_at = now()
        from observations
        where character.character_id = observations.character_id
          and (
            character.affiliation_checked_at is null
            or character.affiliation_checked_at <= ${observedAtValue}::timestamptz
          )
      `)
      signal?.throwIfAborted()
    }

    if (omitted.length > 0) {
      await transaction
        .update(characters)
        .set({
          affiliationCheckedAt: observedAt,
          affiliationResolutionState: 'pending',
          nextAffiliationCheck: nextAffiliationCheckForCharacter(observedAtValue),
          updatedAt: new Date(),
        })
        .where(
          and(
            sql`${characters.characterId} in (${sql.join(
              omitted.map((characterId) => sql`${characterId}`),
              sql`, `,
            )})`,
            sql`(${characters.affiliationCheckedAt} is null or ${characters.affiliationCheckedAt} <= ${observedAt.toISOString()}::timestamptz)`,
          ),
        )
      signal?.throwIfAborted()
    }
    await afterPersist?.(transaction, affectedUserIds, observedAt)
    signal?.throwIfAborted()
    for (const character of affectedCharacters) {
      // oxlint-disable-next-line no-await-in-loop -- Event sequence follows stable character order.
      await appendDomainEvent(transaction, {
        aggregateId: String(character.characterId),
        occurredAt: observedAt,
        payload: character,
        payloadVersion: 1,
        type: 'character.affiliation-observed',
      })
    }
    signal?.throwIfAborted()
  })
}

async function lookupAffiliationResult(characterIds: readonly number[], signal?: AbortSignal) {
  return bulkAffiliationRead.execute({ body: [...characterIds], ...(signal ? { signal } : {}) })
}

function validateAffiliationBatch(characterIds: readonly number[]) {
  if (
    characterIds.length === 0 ||
    characterIds.length > affiliationBatchLimit ||
    characterIds.some((characterId) => !Number.isSafeInteger(characterId) || characterId <= 0)
  ) {
    throw new Error('Invalid affiliation batch')
  }
  return [...characterIds]
}

function nextAffiliationCheckSql(observedAt: string) {
  return sql`${observedAt}::timestamptz + (
    case when exists (
      select 1 from sessions
      where sessions.user_id = character.user_id
        and sessions.expires_at > ${observedAt}::timestamptz
    ) then ${env.AFFILIATION_ACTIVE_INTERVAL_SECONDS}::integer
    else ${env.AFFILIATION_INACTIVE_INTERVAL_SECONDS}::integer
    end
  ) * interval '1 second'`
}

function nextAffiliationCheckForCharacter(observedAt: string) {
  return sql`${observedAt}::timestamptz + (
    case when exists (
      select 1 from sessions
      where sessions.user_id = ${characters.userId}
        and sessions.expires_at > ${observedAt}::timestamptz
    ) then ${env.AFFILIATION_ACTIVE_INTERVAL_SECONDS}::integer
    else ${env.AFFILIATION_INACTIVE_INTERVAL_SECONDS}::integer
    end
  ) * interval '1 second'`
}
