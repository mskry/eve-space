import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetCharactersCharacterIdLocationResponse,
  GetCharactersCharacterIdShipResponse,
} from '@evespace/esi-client/types'
import {
  combineEsiReadResultMetadata,
  createCharacterEsiRead,
  createPublicEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { getUniverseSolarSystem, getUniverseStation } from '../universe/locations.js'

interface CharacterLocationSnapshot {
  solarSystemId: number
  stationId?: number
  structureId?: number
}

const characterLocationRead = createCharacterEsiRead({
  operation: 'location',
  name: 'character-location-core',
  descriptor: operationRegistry.GetCharactersCharacterIdLocation.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterLocationSnapshot(response.data),
})

interface CharacterShipSnapshot {
  typeId: number
  name: string
}

const characterShipRead = createCharacterEsiRead({
  operation: 'ship',
  name: 'character-ship-core',
  descriptor: operationRegistry.GetCharactersCharacterIdShip.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterShipSnapshot(response.data),
})

const universeTypeRead = createPublicEsiRead({
  operation: 'universe-type',
  name: 'universe-type-core',
  descriptor: operationRegistry.GetUniverseTypesTypeId.transport,
  encodeRequest: (input: { typeId: number }) => ({ path: { type_id: input.typeId } }),
  map: (response) => ({ name: response.data.name }),
})

export const locationScope = characterLocationRead.requiredScope
export const shipScope = characterShipRead.requiredScope

export interface CharacterLocation extends EsiReadResultMetadata {
  solarSystemId: number
  solarSystemName: string
  stationId?: number
  stationName?: string
  structureId?: number
}

export interface CharacterShip extends EsiReadResultMetadata {
  typeId: number
  typeName: string
  name: string
}

export async function getCharacterLocation(
  characterId: number,
  subjectLifecycleId: string,
): Promise<CharacterLocation> {
  const positionResult = await characterLocationRead.execute({ characterId, subjectLifecycleId })
  const position = positionResult.data

  const [system, station] = await Promise.all([
    getUniverseSolarSystem(position.solarSystemId),
    position.stationId ? getUniverseStation(position.stationId) : Promise.resolve(undefined),
  ])

  return {
    solarSystemId: position.solarSystemId,
    solarSystemName: system.data.name,
    ...(position.stationId
      ? { stationId: position.stationId, stationName: station?.data.name }
      : {}),
    ...(position.structureId ? { structureId: position.structureId } : {}),
    ...combineEsiReadResultMetadata([
      toEsiReadResultMetadata(positionResult),
      toEsiReadResultMetadata(system),
      ...(station ? [toEsiReadResultMetadata(station)] : []),
    ]),
  }
}

export async function getCharacterShip(
  characterId: number,
  subjectLifecycleId: string,
): Promise<CharacterShip> {
  const shipResult = await characterShipRead.execute({ characterId, subjectLifecycleId })
  const ship = shipResult.data
  const typeResult = await universeTypeRead.execute({ typeId: ship.typeId })

  return {
    typeId: ship.typeId,
    typeName: typeResult.data.name,
    name: ship.name,
    ...combineEsiReadResultMetadata([
      toEsiReadResultMetadata(shipResult),
      toEsiReadResultMetadata(typeResult),
    ]),
  }
}

function mapCharacterLocationSnapshot(
  result: GetCharactersCharacterIdLocationResponse,
): CharacterLocationSnapshot {
  return {
    solarSystemId: result.solar_system_id,
    ...(result.station_id !== undefined ? { stationId: result.station_id } : {}),
    ...(result.structure_id !== undefined ? { structureId: result.structure_id } : {}),
  }
}

function mapCharacterShipSnapshot(
  result: GetCharactersCharacterIdShipResponse,
): CharacterShipSnapshot {
  return {
    typeId: result.ship_type_id,
    name: result.ship_name,
  }
}
