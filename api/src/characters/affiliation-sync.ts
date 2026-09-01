import { createCharacterClient } from '@evespace/esi-client/domains/character'
import { and, asc, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { characters } from '../db/schema.js'
import { env } from '../env.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { getEsiOperationContract } from '../esi-resilience/catalog.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'

const affiliationIdentity = getEsiOperationContract('bulk-affiliation').identity
if (affiliationIdentity.kind !== 'set')
  throw new Error('Bulk affiliation identity must be set-like')
export const affiliationBatchLimit = affiliationIdentity.maximumItems

export const affiliationJobPayload = z
  .object({
    operationId: z
      .string()
      .regex(/^affiliation-\d+(?:-\d+)*(?:--[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})?$/i),
    characterIds: z.array(z.number().int().positive()).min(1).max(affiliationBatchLimit),
  })
  .strict()

export type AffiliationJobPayload = z.infer<typeof affiliationJobPayload>

export interface AffiliationObservation {
  characterId: number
  corporationId: number
  allianceId: number | null
}

export async function getCharacterAffiliationObservation(characterId: number) {
  const result = await lookupAffiliationResult([characterId])
  const observation = result.data.find((entry) => entry.characterId === characterId)
  if (!observation) return null
  return {
    ...observation,
    affiliationCheckedAt: new Date(result.validatedAt),
    stale: result.stale,
  }
}

export class AffiliationCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Character affiliation refresh is deferred by ESI cooldown')
  }
}

export async function selectDueAffiliationCharacterIds(
  now = new Date(),
  limit = affiliationBatchLimit,
) {
  const boundedLimit = Math.min(affiliationBatchLimit, Math.max(1, Math.floor(limit)))
  return db
    .select({ characterId: characters.characterId })
    .from(characters)
    .where(and(lte(characters.nextAffiliationCheck, now)))
    .orderBy(asc(characters.nextAffiliationCheck), asc(characters.characterId))
    .limit(boundedLimit)
}

export function partitionAffiliationCharacterIds(characterIds: readonly number[]) {
  const batches: number[][] = []
  for (let index = 0; index < characterIds.length; index += affiliationBatchLimit)
    batches.push(characterIds.slice(index, index + affiliationBatchLimit))
  return batches
}

export function affiliationOperationIdentity(characterIds: readonly number[], refreshId?: string) {
  const ordered = characterIds.toSorted((left, right) => left - right)
  const refreshSuffix = refreshId ? `--${refreshId}` : ''
  return `affiliation-${ordered.join('-')}${refreshSuffix}`
}

export async function processAffiliationBatch(
  characterIds: readonly number[],
  options: {
    observedAt?: Date
    lookup?: (ids: readonly number[]) => Promise<readonly AffiliationObservation[]>
  } = {},
) {
  const parsed = affiliationJobPayload.parse({
    operationId: affiliationOperationIdentity(characterIds),
    characterIds,
  })
  const observedAt = options.observedAt ?? new Date()
  const lookup = options.lookup ?? lookupAffiliations
  let observations: readonly AffiliationObservation[]
  try {
    observations = await lookup(parsed.characterIds)
  } catch (error) {
    if (error instanceof EsiQuotaError) throw new AffiliationCooldownError(error.retryAfterSeconds)
    throw error
  }
  await persistAffiliationObservations(parsed.characterIds, observations, observedAt)
}

export async function persistAffiliationObservations(
  requestedCharacterIds: readonly number[],
  observations: readonly AffiliationObservation[],
  observedAt: Date,
) {
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
    }
  })
}

async function lookupAffiliations(characterIds: readonly number[]) {
  return (await lookupAffiliationResult(characterIds)).data
}

async function lookupAffiliationResult(characterIds: readonly number[]) {
  return getEsiResilienceLayer().executeNoValue<AffiliationObservation[]>({
    operation: 'bulk-affiliation',
    inputs: { characterIds },
    load: async () => {
      const response = await createCharacterClient({
        fetch: createEsiTransport('bulk-affiliation'),
      })
        .withMetadata()
        .lookupAffiliations({ body: [...characterIds] })
      return {
        data: response.data.map((affiliation) => ({
          characterId: affiliation.character_id,
          corporationId: affiliation.corporation_id,
          allianceId: affiliation.alliance_id ?? null,
        })),
        meta: response.meta,
      }
    },
  })
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
