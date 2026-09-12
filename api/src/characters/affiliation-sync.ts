import { operationRegistry } from '@evespace/esi-client/operations'
import { and, asc, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { characters } from '../db/schema.js'
import { env } from '../env.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { createPublicEsiRead } from '../esi-gateway/feature-execution.js'

const generatedAffiliationBatchLimit =
  operationRegistry.PostCharactersAffiliation.transport.protocol.maximumBatchSize
if (generatedAffiliationBatchLimit === null)
  throw new Error('Bulk affiliation operation must declare a maximum batch size')
const affiliationBatchLimit = generatedAffiliationBatchLimit

const bulkAffiliationRead = createPublicEsiRead({
  operation: 'bulk-affiliation',
  name: 'bulk-affiliation-core',
  descriptor: operationRegistry.PostCharactersAffiliation.transport,
  encodeRequest: (input: { body: number[]; signal?: AbortSignal }) => ({ body: input.body }),
  map: ({ data }): AffiliationObservation[] =>
    data.map((affiliation) => ({
      characterId: affiliation.character_id,
      corporationId: affiliation.corporation_id,
      allianceId: affiliation.alliance_id ?? null,
    })),
})

interface AffiliationObservation {
  characterId: number
  corporationId: number
  allianceId: number | null
}

export async function observeCharacterAffiliation(characterId: number, signal?: AbortSignal) {
  const result = await lookupAffiliationResult([characterId], signal)
  const observation = result.data.find((entry) => entry.characterId === characterId)
  if (!observation) return null
  return {
    ...observation,
    affiliationCheckedAt: new Date(result.validatedAt),
    stale: result.stale,
  }
}

export async function observeAndPersistCharacterAffiliation(
  characterId: number,
  signal?: AbortSignal,
) {
  const observation = await observeCharacterAffiliation(characterId, signal)
  signal?.throwIfAborted()
  if (observation && !observation.stale)
    await persistAffiliationObservations(
      [characterId],
      [observation],
      observation.affiliationCheckedAt,
      signal,
    )
  return observation
}

export async function selectDueAffiliationBatches(now = new Date()) {
  const due = await db
    .select({ characterId: characters.characterId })
    .from(characters)
    .where(and(lte(characters.nextAffiliationCheck, now)))
    .orderBy(asc(characters.nextAffiliationCheck), asc(characters.characterId))
    .limit(affiliationBatchLimit)
  if (due.length === 0) return []
  return [due.map(({ characterId }) => characterId).toSorted((left, right) => left - right)]
}

export async function processAffiliationBatch(
  characterIds: readonly number[],
  signal?: AbortSignal,
) {
  const batch = validateAffiliationBatch(characterIds)
  signal?.throwIfAborted()
  const observedAt = new Date()
  const result = await lookupAffiliationResult(batch, signal)
  signal?.throwIfAborted()
  await persistAffiliationObservations(batch, result.data, observedAt, signal)
}

async function persistAffiliationObservations(
  requestedCharacterIds: readonly number[],
  observations: readonly AffiliationObservation[],
  observedAt: Date,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const requested = new Set(requestedCharacterIds)
  const returned = new Map<number, AffiliationObservation>()
  for (const observation of observations) {
    if (requested.has(observation.characterId)) returned.set(observation.characterId, observation)
  }
  const omitted = requestedCharacterIds.filter((characterId) => !returned.has(characterId))
  const observedAtValue = observedAt.toISOString()
  const nextCheck = nextAffiliationCheckSql(observedAtValue)

  await db.transaction(async (transaction) => {
    if (returned.size > 0) {
      const records = JSON.stringify(
        Array.from(returned.values(), (observation) => ({
          character_id: observation.characterId,
          corporation_id: observation.corporationId,
          alliance_id: observation.allianceId,
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
    const affectedCharacters = await transaction
      .select({ userId: characters.userId, characterId: characters.characterId })
      .from(characters)
      .where(inArray(characters.characterId, [...requested]))
      .orderBy(asc(characters.userId), asc(characters.characterId))
    signal?.throwIfAborted()
    for (const character of affectedCharacters)
      // oxlint-disable-next-line no-await-in-loop -- Event sequence follows stable character order.
      await appendDomainEvent(transaction, {
        type: 'character.affiliation-observed',
        payloadVersion: 1,
        aggregateId: String(character.characterId),
        payload: character,
        occurredAt: observedAt,
      })
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
  )
    throw new Error('Invalid affiliation batch')
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
