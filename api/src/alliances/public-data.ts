import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetAlliancesAllianceIdResponse } from '@evespace/esi-client/types'
import { createPublicEsiRead } from '../esi-gateway/feature-execution.js'

export interface PublicAllianceResult {
  name: string
  ticker: string
  executorCorporationId: number | null
}

const publicAllianceRead = createPublicEsiRead({
  operation: 'public-alliance',
  name: 'public-alliance-core',
  descriptor: operationRegistry.GetAlliancesAllianceId.transport,
  encodeRequest: (input: { allianceId: number }) => ({
    path: { alliance_id: input.allianceId },
  }),
  map: (response): PublicAllianceResult => mapPublicAlliance(response.data),
})

export function getAlliancePublicResult(allianceId: number) {
  return publicAllianceRead.execute({ allianceId })
}

function mapPublicAlliance(alliance: GetAlliancesAllianceIdResponse): PublicAllianceResult {
  return {
    name: alliance.name,
    ticker: alliance.ticker,
    executorCorporationId: alliance.executor_corporation_id ?? null,
  }
}
