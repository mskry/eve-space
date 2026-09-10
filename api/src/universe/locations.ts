import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetUniverseStationsStationIdResponse,
  GetUniverseSystemsSystemIdResponse,
} from '@evespace/esi-client/types'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { definePublicEsiRepresentation } from '../esi-resilience/representations.js'

const universeSolarSystemRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'universe-solar-system',
    name: 'universe-solar-system-core',
    descriptor: operationRegistry.GetUniverseSystemsSystemId.transport,
    encodeRequest: (input: { systemId: number }) => ({ path: { system_id: input.systemId } }),
    map: (response): GetUniverseSystemsSystemIdResponse => response.data,
  }),
)

const universeStationRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'universe-station',
    name: 'universe-station-core',
    descriptor: operationRegistry.GetUniverseStationsStationId.transport,
    encodeRequest: (input: { stationId: number }) => ({ path: { station_id: input.stationId } }),
    map: (response): GetUniverseStationsStationIdResponse => response.data,
  }),
)

export function getUniverseSolarSystem(systemId: number) {
  return execute(universeSolarSystemRepresentation, { systemId })
}

export function getUniverseStation(stationId: number) {
  return execute(universeStationRepresentation, { stationId })
}
