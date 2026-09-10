import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetAlliancesAllianceIdResponse } from '@evespace/esi-client/types'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { definePublicEsiRepresentation } from '../esi-resilience/representations.js'

export interface PublicAllianceResult {
  name: string
  ticker: string
  executorCorporationId: number | null
}

export const publicAllianceRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'public-alliance',
    name: 'public-alliance-core',
    descriptor: operationRegistry.GetAlliancesAllianceId.transport,
    encodeRequest: (input: { allianceId: number }) => ({
      path: { alliance_id: input.allianceId },
    }),
    map: (response): PublicAllianceResult => mapPublicAlliance(response.data),
  }),
)

function mapPublicAlliance(alliance: GetAlliancesAllianceIdResponse): PublicAllianceResult {
  return {
    name: alliance.name,
    ticker: alliance.ticker,
    executorCorporationId: alliance.executor_corporation_id ?? null,
  }
}
