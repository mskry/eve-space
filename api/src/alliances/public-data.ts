import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetAlliancesAllianceIdResponse } from '@evespace/esi-client/types'
import { z } from 'zod'
import { createPublicEsiRead } from '../esi-gateway/feature-execution.js'

export interface PublicAllianceResult {
  name: string
  ticker: string
  executorCorporationId: number | null
}

const publicAllianceCacheSchema = z.object({
  executorCorporationId: z.number().nullable(),
  name: z.string(),
  ticker: z.string(),
})

const publicAllianceRead = createPublicEsiRead({
  cacheSchema: publicAllianceCacheSchema,
  descriptor: operationRegistry.GetAlliancesAllianceId.transport,
  encodeRequest: (input: { allianceId: number }) => ({
    path: { alliance_id: input.allianceId },
  }),
  map: (response): PublicAllianceResult => mapPublicAlliance(response.data),
  name: 'public-alliance-core',
  operation: 'public-alliance',
})

export function getAlliancePublicResult(allianceId: number) {
  return publicAllianceRead.execute({ allianceId })
}

function mapPublicAlliance(alliance: GetAlliancesAllianceIdResponse): PublicAllianceResult {
  return {
    executorCorporationId: alliance.executor_corporation_id ?? null,
    name: alliance.name,
    ticker: alliance.ticker,
  }
}
