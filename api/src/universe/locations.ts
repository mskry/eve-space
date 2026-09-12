import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetUniverseStationsStationIdResponse,
  GetUniverseSystemsSystemIdResponse,
} from '@evespace/esi-client/types'
import { createPublicEsiRead } from '../esi-gateway/feature-execution.js'

const universeSolarSystemRead = createPublicEsiRead({
  operation: 'universe-solar-system',
  name: 'universe-solar-system-core',
  descriptor: operationRegistry.GetUniverseSystemsSystemId.transport,
  encodeRequest: (input: { systemId: number }) => ({ path: { system_id: input.systemId } }),
  map: (response): GetUniverseSystemsSystemIdResponse => response.data,
})

const universeStationRead = createPublicEsiRead({
  operation: 'universe-station',
  name: 'universe-station-core',
  descriptor: operationRegistry.GetUniverseStationsStationId.transport,
  encodeRequest: (input: { stationId: number }) => ({ path: { station_id: input.stationId } }),
  map: (response): GetUniverseStationsStationIdResponse => response.data,
})

export function getUniverseSolarSystem(systemId: number) {
  return universeSolarSystemRead.execute({ systemId })
}

export function getUniverseStation(stationId: number) {
  return universeStationRead.execute({ stationId })
}
