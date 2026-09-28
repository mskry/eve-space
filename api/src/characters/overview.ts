import { operationRegistry } from '@evespace/esi-client/operations'
import {
  currentLocationKind,
  projectCurrentLocationIdentity,
  projectCurrentShipIdentity,
} from '@eve-space/core-eve-projections/current-observation'
import { z } from 'zod'
import {
  combineEsiReadResultMetadata,
  createCharacterEsiRead,
  createPublicEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { getUniverseSolarSystem, getUniverseStation } from '../universe/locations.js'

const characterLocationCacheSchema = z.object({
  solarSystemId: z.number(),
  stationId: z.number().optional(),
  structureId: z.number().optional(),
})

const characterLocationRead = createCharacterEsiRead({
  cacheSchema: characterLocationCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdLocation.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => projectCurrentLocationIdentity(response.data),
  name: 'character-location-core',
  operation: 'location',
})

const characterShipCacheSchema = z.object({ name: z.string(), typeId: z.number() })
const universeTypeCacheSchema = z.object({ groupId: z.number(), name: z.string() })

const characterShipRead = createCharacterEsiRead({
  cacheSchema: characterShipCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdShip.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => projectCurrentShipIdentity(response.data),
  name: 'character-ship-core',
  operation: 'ship',
})

const universeTypeRead = createPublicEsiRead({
  cacheSchema: universeTypeCacheSchema,
  descriptor: operationRegistry.GetUniverseTypesTypeId.transport,
  encodeRequest: (input: { typeId: number }) => ({ path: { type_id: input.typeId } }),
  map: (response) => ({ name: response.data.name, groupId: response.data.group_id }),
  name: 'universe-type-core',
  operation: 'universe-type',
})

export const locationScope = characterLocationRead.requiredScope
export const shipScope = characterShipRead.requiredScope

export interface CharacterLocation extends EsiReadResultMetadata {
  solarSystemId: number
  solarSystemName: string
  solarSystemSecurityStatus: number
  locationType: 'space' | 'station' | 'structure'
  stationId?: number
  stationName?: string
  structureId?: number
}

export interface CharacterShip extends EsiReadResultMetadata {
  typeId: number
  typeName: string
  groupId: number
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
    position.stationId ? getUniverseStation(position.stationId) : Promise.resolve(),
  ])
  const locationType = currentLocationKind(position)

  return {
    locationType,
    solarSystemId: position.solarSystemId,
    solarSystemName: system.data.name,
    solarSystemSecurityStatus: system.data.security_status,
    ...(position.stationId && { stationId: position.stationId, stationName: station?.data.name }),
    ...(position.structureId && { structureId: position.structureId }),
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
    groupId: typeResult.data.groupId,
    name: ship.name,
    typeId: ship.typeId,
    typeName: typeResult.data.name,
    ...combineEsiReadResultMetadata([
      toEsiReadResultMetadata(shipResult),
      toEsiReadResultMetadata(typeResult),
    ]),
  }
}
