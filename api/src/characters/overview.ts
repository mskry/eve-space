import { createLocationClient } from '@evespace/esi-client/domains/location'
import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { getCharacterSkillsData } from './skills.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { combineEsiResultMetadata, toEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'

export const locationScope = getCharacterEsiScope('location')
export const shipScope = getCharacterEsiScope('ship')
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
  const positionResult = await getEsiResilienceLayer().getCharacter({
    operation: 'location',
    inputs: { characterId },
    load: (authority, revalidation) =>
      createLocationClient({
        fetch: createEsiTransport('location', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .get(characterId, revalidation),
  })
  const position = positionResult.data

  const [system, station] = await Promise.all([
    getEsiResilienceLayer().getPublic({
      operation: 'universe-solar-system',
      inputs: { systemId: position.solar_system_id },
      load: (revalidation) =>
        createUniverseClient({ fetch: createEsiTransport('universe-solar-system') })
          .withMetadata()
          .getSolarSystem(position.solar_system_id, revalidation),
    }),
    position.station_id
      ? getEsiResilienceLayer().getPublic({
          operation: 'universe-station',
          inputs: { stationId: position.station_id },
          load: (revalidation) =>
            createUniverseClient({ fetch: createEsiTransport('universe-station') })
              .withMetadata()
              .getStation(position.station_id!, revalidation),
        })
      : Promise.resolve(undefined),
  ])

  return {
    solarSystemId: position.solar_system_id,
    solarSystemName: system.data.name,
    ...(position.station_id
      ? { stationId: position.station_id, stationName: station?.data.name }
      : {}),
    ...(position.structure_id ? { structureId: position.structure_id } : {}),
    ...combineEsiResultMetadata([
      toEsiResultMetadata(positionResult),
      toEsiResultMetadata(system),
      ...(station ? [toEsiResultMetadata(station)] : []),
    ]),
  }
}

export async function getCharacterShip(characterId: number): Promise<CharacterShip> {
  const shipResult = await getEsiResilienceLayer().getCharacter({
    operation: 'ship',
    inputs: { characterId },
    load: (authority, revalidation) =>
      createLocationClient({
        fetch: createEsiTransport('ship', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .getCurrentShip(characterId, revalidation),
  })
  const ship = shipResult.data
  const typeResult = await getEsiResilienceLayer().getPublic({
    operation: 'universe-type',
    inputs: { typeId: ship.ship_type_id },
    load: (revalidation) =>
      createUniverseClient({ fetch: createEsiTransport('universe-type') })
        .withMetadata()
        .getType(ship.ship_type_id, revalidation),
  })

  return {
    typeId: ship.ship_type_id,
    typeName: typeResult.data.name,
    name: ship.ship_name,
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
