import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetCharactersCharacterIdLocationResponse,
  GetCharactersCharacterIdShipResponse,
} from '@evespace/esi-client/types'
import { getCharacterEsiScope } from '../esi-resilience/catalog-access.js'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import {
  defineCharacterEsiRepresentation,
  definePublicEsiRepresentation,
} from '../esi-resilience/representations.js'
import { combineEsiResultMetadata, toEsiResultMetadata } from '../esi-resilience/result-metadata.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'
import { getUniverseSolarSystem, getUniverseStation } from '../universe/locations.js'
import { getCharacterSkillsData } from './skills.js'

interface CharacterLocationSnapshot {
  solarSystemId: number
  stationId?: number
  structureId?: number
}

const characterLocationRepresentation = registerEsiRepresentation(
  defineCharacterEsiRepresentation({
    operation: 'location',
    name: 'character-location-core',
    descriptor: operationRegistry.GetCharactersCharacterIdLocation.transport,
    encodeRequest: (input: { characterId: number }) => ({
      path: { character_id: input.characterId },
    }),
    map: (response) => mapCharacterLocationSnapshot(response.data),
  }),
)

interface CharacterShipSnapshot {
  typeId: number
  name: string
}

const characterShipRepresentation = registerEsiRepresentation(
  defineCharacterEsiRepresentation({
    operation: 'ship',
    name: 'character-ship-core',
    descriptor: operationRegistry.GetCharactersCharacterIdShip.transport,
    encodeRequest: (input: { characterId: number }) => ({
      path: { character_id: input.characterId },
    }),
    map: (response) => mapCharacterShipSnapshot(response.data),
  }),
)

const universeTypeRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'universe-type',
    name: 'universe-type-core',
    descriptor: operationRegistry.GetUniverseTypesTypeId.transport,
    encodeRequest: (input: { typeId: number }) => ({ path: { type_id: input.typeId } }),
    map: (response) => ({ name: response.data.name }),
  }),
)

export const locationScope = getCharacterEsiScope(characterLocationRepresentation.operation)
export const shipScope = getCharacterEsiScope(characterShipRepresentation.operation)
export { characterSkillsScope as skillsScope } from './skills.js'

export interface CharacterLocation extends EsiResultMetadata {
  solarSystemId: number
  solarSystemName: string
  stationId?: number
  stationName?: string
  structureId?: number
}

export interface CharacterShip extends EsiResultMetadata {
  typeId: number
  typeName: string
  name: string
}

interface CharacterSkillsSummaryData {
  totalSp: number
  unallocatedSp: number
}

export type CharacterSkillsSummary = CharacterSkillsSummaryData & EsiResultMetadata

export async function getCharacterLocation(characterId: number): Promise<CharacterLocation> {
  const positionResult = await execute(characterLocationRepresentation, { characterId })
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
    ...combineEsiResultMetadata([
      toEsiResultMetadata(positionResult),
      toEsiResultMetadata(system),
      ...(station ? [toEsiResultMetadata(station)] : []),
    ]),
  }
}

export async function getCharacterShip(characterId: number): Promise<CharacterShip> {
  const shipResult = await execute(characterShipRepresentation, { characterId })
  const ship = shipResult.data
  const typeResult = await execute(universeTypeRepresentation, { typeId: ship.typeId })

  return {
    typeId: ship.typeId,
    typeName: typeResult.data.name,
    name: ship.name,
    ...combineEsiResultMetadata([toEsiResultMetadata(shipResult), toEsiResultMetadata(typeResult)]),
  }
}

export async function getCharacterSkillsSummary(
  characterId: number,
): Promise<CharacterSkillsSummary> {
  const skills = await getCharacterSkillsData(characterId)
  return {
    totalSp: skills.data.totalSp,
    unallocatedSp: skills.data.unallocatedSp,
    ...toEsiResultMetadata(skills),
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
