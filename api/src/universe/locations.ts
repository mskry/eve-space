import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetUniverseStationsStationIdResponse,
  GetUniverseSystemsSystemIdResponse,
} from '@evespace/esi-client/types'
import { createPublicEsiRead } from '../esi-gateway/feature-execution.js'

const universeSolarSystemRead = createPublicEsiRead({
  cacheSchema: operationRegistry.GetUniverseSystemsSystemId.responseSchema,
  descriptor: operationRegistry.GetUniverseSystemsSystemId.transport,
  encodeRequest: (input: { systemId: number }) => ({ path: { system_id: input.systemId } }),
  map: (response): GetUniverseSystemsSystemIdResponse => response.data,
  name: 'universe-solar-system-core',
  operation: 'universe-solar-system',
})

const universeStationRead = createPublicEsiRead({
  cacheSchema: operationRegistry.GetUniverseStationsStationId.responseSchema,
  descriptor: operationRegistry.GetUniverseStationsStationId.transport,
  encodeRequest: (input: { stationId: number }) => ({ path: { station_id: input.stationId } }),
  map: (response): GetUniverseStationsStationIdResponse => response.data,
  name: 'universe-station-core',
  operation: 'universe-station',
})

export function getUniverseSolarSystem(systemId: number) {
  return universeSolarSystemRead.execute({ systemId })
}

export function getUniverseStation(stationId: number) {
  return universeStationRead.execute({ stationId })
}
