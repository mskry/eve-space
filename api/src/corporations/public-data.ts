import type { EsiResponseMetadata } from '@evespace/esi-client'
import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetCorporationsCorporationIdAlliancehistoryResponse,
  GetCorporationsCorporationIdResponse,
} from '@evespace/esi-client/types'
import { z } from 'zod'
import { eveFormattedTextToPlainText } from '../text/eve-formatted-text.js'
import { createPublicEsiRead, type EsiReadResult } from '../esi-gateway/feature-execution.js'
import { errorStatus } from '../error-status.js'
import { resolveUniverseNames } from '../universe/names.js'

interface CorporationPublic {
  corporationId: number
  name: string
  ticker: string
  memberCount: number
  ceoId: number | null
  ceoName: string | null
  creatorId: number | null
  creatorName: string | null
  taxRate: number
  loyaltyPointTaxRate: number
  dateFounded: string | null
  description: string | null
  url: string | null
  factionId: number | null
  homeStationId: number | null
  homeStationName: string | null
  shares: number | null
  allianceId: number | null
  allianceName: string | null
  type: 'player_owned' | 'npc_owned'
  state: 'active' | 'closed'
  friendlyFire: 'legal' | 'illegal'
  warEligible: boolean
  warHistory: Array<{ time: string; againstId: number; againstType: string }>
}

type PublicCorporationResult = Omit<CorporationPublic, 'corporationId' | 'warHistory'>

/**
 * An unknown corporation ID is a definitive answer, so it is stored like any other response.
 * Re-querying ESI per lookup would spend five error-budget tokens each time.
 */
type CorporationLookup = { found: true; corporation: PublicCorporationResult } | { found: false }

interface AllianceHistoryEntry {
  allianceId: number | null
  allianceName: string | null
  isDeleted: boolean
  recordId: number
  startDate: string
}

const publicCorporationResultCacheSchema = z.object({
  allianceId: z.number().nullable(),
  allianceName: z.string().nullable(),
  ceoId: z.number().nullable(),
  ceoName: z.string().nullable(),
  creatorId: z.number().nullable(),
  creatorName: z.string().nullable(),
  dateFounded: z.string().nullable(),
  description: z.string().nullable(),
  factionId: z.number().nullable(),
  friendlyFire: z.enum(['legal', 'illegal']),
  homeStationId: z.number().nullable(),
  homeStationName: z.string().nullable(),
  loyaltyPointTaxRate: z.number(),
  memberCount: z.number(),
  name: z.string(),
  shares: z.number().nullable(),
  state: z.enum(['active', 'closed']),
  taxRate: z.number(),
  ticker: z.string(),
  type: z.enum(['player_owned', 'npc_owned']),
  url: z.string().nullable(),
  warEligible: z.boolean(),
})
const corporationLookupCacheSchema = z.discriminatedUnion('found', [
  z.object({ corporation: publicCorporationResultCacheSchema, found: z.literal(true) }),
  z.object({ found: z.literal(false) }),
])
const corporationAllianceHistoryCacheSchema = z.array(
  z.object({
    allianceId: z.number().nullable(),
    allianceName: z.string().nullable(),
    isDeleted: z.boolean(),
    recordId: z.number(),
    startDate: z.string(),
  }),
)

const publicCorporationRead = createPublicEsiRead({
  cacheSchema: corporationLookupCacheSchema,
  descriptor: operationRegistry.GetCorporationsCorporationId.transport,
  encodeRequest: (input: { corporationId: number }) => ({
    path: { corporation_id: input.corporationId },
  }),
  map: async (response): Promise<CorporationLookup> => ({
    found: true,
    corporation: await mapPublicCorporation(response.data),
  }),
  name: 'public-corporation-core',
  operation: 'public-corporation',
  recover: (error) =>
    errorStatus(error) === 404
      ? { data: { found: false as const }, meta: errorMetadata(error) }
      : undefined,
})

const corporationAllianceHistoryRead = createPublicEsiRead({
  cacheSchema: corporationAllianceHistoryCacheSchema,
  descriptor: operationRegistry.GetCorporationsCorporationIdAlliancehistory.transport,
  encodeRequest: (input: { corporationId: number }) => ({
    path: { corporation_id: input.corporationId },
  }),
  map: (response) => mapCorporationAllianceHistory(response.data),
  name: 'corporation-alliance-history-core',
  operation: 'corporation-alliance-history',
})

const corporationNpcListRead = createPublicEsiRead({
  cacheSchema: operationRegistry.GetCorporationsNpccorps.responseSchema,
  descriptor: operationRegistry.GetCorporationsNpccorps.transport,
  encodeRequest: () => ({}),
  map: (response): number[] => response.data,
  name: 'corporation-npc-list-core',
  operation: 'corporation-npc-list',
})

export async function getCorporationPublic(corporationId: number): Promise<CorporationPublic> {
  return (await getCorporationPublicResult(corporationId)).data
}

export async function getCorporationPublicResult(
  corporationId: number,
): Promise<EsiReadResult<CorporationPublic>> {
  const result = await publicCorporationRead.execute({ corporationId })
  if (!result.data.found) {
    throw Object.assign(new Error('Corporation not found'), { status: 404 })
  }
  return { ...result, data: { corporationId, warHistory: [], ...result.data.corporation } }
}

export async function getCorporationAllianceHistory(
  corporationId: number,
): Promise<AllianceHistoryEntry[]> {
  return (await getCorporationAllianceHistoryResult(corporationId)).data
}

export function getCorporationAllianceHistoryResult(
  corporationId: number,
): Promise<EsiReadResult<AllianceHistoryEntry[]>> {
  return corporationAllianceHistoryRead.execute({ corporationId })
}

export async function getNpcCorporations(): Promise<number[]> {
  return (await corporationNpcListRead.execute({})).data
}

async function mapPublicCorporation(
  corporation: GetCorporationsCorporationIdResponse,
): Promise<PublicCorporationResult> {
  const ceoId = corporation.ceo_id ?? null
  const creatorId = corporation.creator_id ?? null
  const allianceId = corporation.alliance_id ?? null
  const homeStationId = corporation.home_station_id ?? null
  const idsToResolve = [
    ...new Set(
      [ceoId, creatorId, allianceId, homeStationId].filter((id): id is number => id !== null),
    ),
  ]
  const names = idsToResolve.length ? await resolveUniverseNames(idsToResolve) : new Map()
  return {
    allianceId,
    allianceName: resolvedCorporationName(allianceId, names),
    ceoId,
    ceoName: resolvedCorporationName(ceoId, names),
    creatorId,
    creatorName: resolvedCorporationName(creatorId, names),
    dateFounded: corporation.date_founded ?? null,
    description: eveFormattedTextToPlainText(corporation.description) ?? null,
    factionId: corporation.enlisted_faction_id ?? null,
    friendlyFire: corporation.friendly_fire,
    homeStationId,
    homeStationName: resolvedCorporationName(homeStationId, names),
    loyaltyPointTaxRate: corporation.tax_rates.loyalty_point,
    memberCount: corporation.member_count,
    name: corporation.name,
    shares: corporation.shares ?? null,
    state: corporation.state,
    taxRate: corporation.tax_rates.isk,
    ticker: corporation.ticker,
    type: corporation.type,
    url: corporation.url ?? null,
    warEligible: corporation.war_eligible,
  }
}

function resolvedCorporationName(
  id: number | null,
  names: Awaited<ReturnType<typeof resolveUniverseNames>>,
) {
  return id ? (names.get(id)?.name ?? null) : null
}

async function mapCorporationAllianceHistory(
  entries: GetCorporationsCorporationIdAlliancehistoryResponse,
): Promise<AllianceHistoryEntry[]> {
  const allianceIds = [
    ...new Set(
      entries
        .map((entry) => entry.alliance_id)
        .filter((id): id is number => id !== null && id !== undefined),
    ),
  ]
  const names = allianceIds.length ? await resolveUniverseNames(allianceIds) : new Map()
  return entries.map((entry) => ({
    allianceId: entry.alliance_id ?? null,
    allianceName: entry.alliance_id ? (names.get(entry.alliance_id)?.name ?? null) : null,
    isDeleted: entry.is_deleted ?? false,
    recordId: entry.record_id,
    startDate: entry.start_date,
  }))
}

function errorMetadata(error: unknown): EsiResponseMetadata {
  if (typeof error === 'object' && error !== null && 'metadata' in error) {
    return error.metadata as EsiResponseMetadata
  }
  return { headers: {}, status: 404 }
}
