import { createCorporationClient } from '@evespace/esi-client/domains/corporation'
import type { EsiResponseMetadata } from '@evespace/esi-client'
import { eveDescriptionToPlainText } from './eve-description.js'
import { getEsiResilienceLayer } from './esi-resilience/resilience.js'
import { createEsiTransport } from './esi-resilience/transport.js'
import { resolveUniverseNames } from './universe-names-service.js'

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

type CorporationLookup = { found: true; corporation: CorporationPublic } | { found: false }

export async function getCorporationPublic(corporationId: number): Promise<CorporationPublic> {
  const lookup = (
    await getEsiResilienceLayer().getPublic<CorporationLookup>({
      operation: 'public-corporation',
      inputs: { corporationId },
      load: async (revalidation) => {
        try {
          const response = await createCorporationClient({
            fetch: createEsiTransport('public-corporation'),
          })
            .withMetadata()
            .getPublicInfo(corporationId, revalidation)
          const corporation = response.data
          const ceoId = corporation.ceo_id ?? null
          const creatorId = corporation.creator_id ?? null
          const allianceId = corporation.alliance_id ?? null
          const homeStationId = corporation.home_station_id ?? null
          const idsToResolve = [
            ...new Set(
              [ceoId, creatorId, allianceId, homeStationId].filter(
                (id): id is number => id !== null,
              ),
            ),
          ]
          const names = idsToResolve.length ? await resolveUniverseNames(idsToResolve) : new Map()
          return {
            data: {
              found: true as const,
              corporation: {
                corporationId,
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
                warHistory: [],
              },
            },
            meta: response.meta,
          }
        } catch (error) {
          if (errorStatus(error) !== 404) throw error
          return { data: { found: false as const }, meta: errorMetadata(error) }
        }
      },
    })
  ).data
  if (!lookup.found) throw Object.assign(new Error('Corporation not found'), { status: 404 })
  return lookup.corporation
}

export async function getCorporationAllianceHistory(
  corporationId: number,
): Promise<AllianceHistoryEntry[]> {
  return (
    await getEsiResilienceLayer().getPublic<AllianceHistoryEntry[]>({
      operation: 'corporation-alliance-history',
      inputs: { corporationId },
      load: async (revalidation) => {
        const response = await createCorporationClient({
          fetch: createEsiTransport('corporation-alliance-history'),
        })
          .withMetadata()
          .listAllianceHistory(corporationId, revalidation)
        const allianceIds = [
          ...new Set(
            response.data
              .map((entry) => entry.alliance_id)
              .filter((id): id is number => id !== null && id !== undefined),
          ),
        ]
        const names = allianceIds.length ? await resolveUniverseNames(allianceIds) : new Map()
        return {
          data: response.data.map((entry) => ({
            allianceId: entry.alliance_id ?? null,
            allianceName: entry.alliance_id ? (names.get(entry.alliance_id)?.name ?? null) : null,
            isDeleted: entry.is_deleted ?? false,
            recordId: entry.record_id,
            startDate: entry.start_date,
          })),
          meta: response.meta,
        }
      },
    })
  ).data
}

export async function getNpcCorporations(): Promise<number[]> {
  return (
    await getEsiResilienceLayer().getPublic({
      operation: 'corporation-npc-list',
      inputs: {},
      load: (revalidation) =>
        createCorporationClient({ fetch: createEsiTransport('corporation-npc-list') })
          .withMetadata()
          .listNpcCorporations(revalidation),
    })
  ).data
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
}

function errorMetadata(error: unknown): EsiResponseMetadata {
  if (typeof error === 'object' && error !== null && 'metadata' in error)
    return error.metadata as EsiResponseMetadata
  return { status: 404, headers: {} }
}
