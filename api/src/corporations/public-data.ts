import type { EsiResponseMetadata } from '@evespace/esi-client'
import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetCorporationsCorporationIdAlliancehistoryResponse,
  GetCorporationsCorporationIdResponse,
} from '@evespace/esi-client/types'
import { eveDescriptionToPlainText } from '../text/eve-description.js'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { definePublicEsiRepresentation } from '../esi-resilience/representations.js'
import type { EsiCachedResult } from '../esi-resilience/types.js'
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
  taxRate: number | null
  dateFounded: string | null
  description: string | null
  url: string | null
  factionId: number | null
  homeStationId: number | null
  homeStationName: string | null
  shares: number | null
  allianceId: number | null
  allianceName: string | null
  type: string
  state: string
  warEligible: boolean | null
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

const publicCorporationRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'public-corporation',
    name: 'public-corporation-core',
    descriptor: operationRegistry.GetCorporationsCorporationId.transport,
    encodeRequest: (input: { corporationId: number }) => ({
      path: { corporation_id: input.corporationId },
    }),
    map: async (response): Promise<CorporationLookup> => ({
      found: true,
      corporation: await mapPublicCorporation(response.data),
    }),
    recover: (error) =>
      errorStatus(error) === 404
        ? { data: { found: false as const }, meta: errorMetadata(error) }
        : undefined,
  }),
)

const corporationAllianceHistoryRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'corporation-alliance-history',
    name: 'corporation-alliance-history-core',
    descriptor: operationRegistry.GetCorporationsCorporationIdAlliancehistory.transport,
    encodeRequest: (input: { corporationId: number }) => ({
      path: { corporation_id: input.corporationId },
    }),
    map: (response) => mapCorporationAllianceHistory(response.data),
  }),
)

const corporationNpcListRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'corporation-npc-list',
    name: 'corporation-npc-list-core',
    descriptor: operationRegistry.GetCorporationsNpccorps.transport,
    encodeRequest: () => ({}),
    map: (response): number[] => response.data,
  }),
)

export async function getCorporationPublic(corporationId: number): Promise<CorporationPublic> {
  return (await getCorporationPublicResult(corporationId)).data
}

export async function getCorporationPublicResult(
  corporationId: number,
): Promise<EsiCachedResult<CorporationPublic>> {
  const result = await execute(publicCorporationRepresentation, { corporationId })
  if (!result.data.found) throw Object.assign(new Error('Corporation not found'), { status: 404 })
  return { ...result, data: { corporationId, warHistory: [], ...result.data.corporation } }
}

export async function getCorporationAllianceHistory(
  corporationId: number,
): Promise<AllianceHistoryEntry[]> {
  return (await execute(corporationAllianceHistoryRepresentation, { corporationId })).data
}

export async function getNpcCorporations(): Promise<number[]> {
  return (await execute(corporationNpcListRepresentation, {})).data
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
    name: corporation.name,
    ticker: corporation.ticker,
    memberCount: corporation.member_count,
    ceoId,
    ceoName: ceoId ? (names.get(ceoId)?.name ?? null) : null,
    creatorId,
    creatorName: creatorId ? (names.get(creatorId)?.name ?? null) : null,
    taxRate: corporation.tax_rates?.isk ?? null,
    dateFounded: corporation.date_founded ?? null,
    description: eveDescriptionToPlainText(corporation.description) ?? null,
    url: corporation.url ?? null,
    factionId: corporation.enlisted_faction_id ?? null,
    homeStationId,
    homeStationName: homeStationId ? (names.get(homeStationId)?.name ?? null) : null,
    shares: corporation.shares ?? null,
    allianceId,
    allianceName: allianceId ? (names.get(allianceId)?.name ?? null) : null,
    type: corporation.type ?? 'unknown',
    state: corporation.state ?? 'unknown',
    warEligible: corporation.war_eligible ?? null,
  }
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
  if (typeof error === 'object' && error !== null && 'metadata' in error)
    return error.metadata as EsiResponseMetadata
  return { status: 404, headers: {} }
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
}
