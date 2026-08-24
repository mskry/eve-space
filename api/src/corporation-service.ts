import { createCorporationClient } from '@evespace/esi-client/domains/corporation'
import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { eveDescriptionToPlainText } from './eve-description.js'
import { getEsiResilienceLayer } from './esi-resilience/resilience.js'
import { createEsiTransport } from './esi-resilience/transport.js'

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

interface AllianceHistoryEntry {
  allianceId: number | null
  allianceName: string | null
  isDeleted: boolean
  recordId: number
  startDate: string
}

export async function getCorporationPublic(corporationId: number): Promise<CorporationPublic> {
  const corporation = (
    await getEsiResilienceLayer().get({
      operation: 'public-corporation',
      resource: `corporation-${corporationId}`,
      load: (revalidation) =>
        createCorporationClient({ fetch: createEsiTransport('public-corporation') })
          .withMetadata()
          .getPublicInfo(corporationId, revalidation),
    })
  ).data
  const ceoId = corporation.ceo_id ?? null
  const creatorId = corporation.creator_id ?? null
  const allianceId = corporation.alliance_id ?? null
  const homeStationId = corporation.home_station_id ?? null
  const idsToResolve = [
    ...new Set(
      [ceoId, creatorId, allianceId, homeStationId].filter((id): id is number => id !== null),
    ),
  ]
  const names = idsToResolve.length ? await resolveNames(idsToResolve) : new Map<number, string>()

  return {
    corporationId,
    name: corporation.name,
    ticker: corporation.ticker,
    memberCount: corporation.member_count,
    ceoId,
    ceoName: ceoId ? (names.get(ceoId) ?? null) : null,
    creatorId,
    creatorName: creatorId ? (names.get(creatorId) ?? null) : null,
    taxRate: corporation.tax_rates?.isk ?? null,
    dateFounded: corporation.date_founded ?? null,
    description: eveDescriptionToPlainText(corporation.description) ?? null,
    url: corporation.url ?? null,
    factionId: corporation.enlisted_faction_id ?? null,
    homeStationId,
    homeStationName: homeStationId ? (names.get(homeStationId) ?? null) : null,
    shares: corporation.shares ?? null,
    allianceId,
    allianceName: allianceId ? (names.get(allianceId) ?? null) : null,
    type: corporation.type ?? 'unknown',
    state: corporation.state ?? 'unknown',
    warEligible: corporation.war_eligible ?? null,
    warHistory: [],
  }
}

export async function getCorporationAllianceHistory(
  corporationId: number,
): Promise<AllianceHistoryEntry[]> {
  const history = (
    await getEsiResilienceLayer().get({
      operation: 'corporation-alliance-history',
      resource: `corporation-alliance-history-${corporationId}`,
      load: (revalidation) =>
        createCorporationClient({ fetch: createEsiTransport('corporation-alliance-history') })
          .withMetadata()
          .listAllianceHistory(corporationId, revalidation),
    })
  ).data
  const allianceIds = [
    ...new Set(
      history
        .map((entry) => entry.alliance_id)
        .filter((id): id is number => id !== null && id !== undefined),
    ),
  ]
  const names = allianceIds.length ? await resolveNames(allianceIds) : new Map<number, string>()
  return history.map((entry) => ({
    allianceId: entry.alliance_id ?? null,
    allianceName: entry.alliance_id ? (names.get(entry.alliance_id) ?? null) : null,
    isDeleted: entry.is_deleted ?? false,
    recordId: entry.record_id,
    startDate: entry.start_date,
  }))
}

export async function getNpcCorporations(): Promise<number[]> {
  return (
    await getEsiResilienceLayer().get({
      operation: 'corporation-npc-list',
      resource: 'npc-corporations',
      load: (revalidation) =>
        createCorporationClient({ fetch: createEsiTransport('corporation-npc-list') })
          .withMetadata()
          .listNpcCorporations(revalidation),
    })
  ).data
}

const MAX_NAME_RESOLUTION_SPLITS = 64

async function resolveNames(ids: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>()
  let splits = 0

  async function resolveChunk(chunk: number[]): Promise<void> {
    try {
      const response = await getEsiResilienceLayer().get({
        operation: 'universe-resolve-names',
        resource: `names-${chunk.join('-')}`,
        load: () =>
          createUniverseClient({ fetch: createEsiTransport('universe-resolve-names') })
            .withMetadata()
            .resolveNames({ body: chunk }),
      })
      for (const entry of response.data) names.set(entry.id, entry.name)
    } catch (error) {
      // ESI returns 404 when a batch contains an invalid historical ID. Retrying
      // other failures would amplify outages and consume the shared error budget.
      if (errorStatus(error) !== 404 || chunk.length === 1 || splits >= MAX_NAME_RESOLUTION_SPLITS)
        return

      splits += 1
      const mid = Math.ceil(chunk.length / 2)
      await Promise.all([resolveChunk(chunk.slice(0, mid)), resolveChunk(chunk.slice(mid))])
    }
  }

  const chunks = Array.from({ length: Math.ceil(ids.length / 500) }, (_, index) =>
    ids.slice(index * 500, (index + 1) * 500),
  )
  await Promise.all(chunks.map(resolveChunk))
  return names
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
}
