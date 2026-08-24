import { createLocationClient } from '@evespace/esi-client/domains/location'
import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { characterSkillsScope, getCharacterSkillsData } from './character-skills-service.js'
import { getEsiResilienceLayer } from './esi-resilience/resilience.js'
import { createEsiTransport } from './esi-resilience/transport.js'
import { getCharacterAuthorization } from './token-service.js'

export const locationScope = 'esi-location.read_location.v1'
export const shipScope = 'esi-location.read_ship_type.v1'
export const skillsScope = characterSkillsScope

export interface CharacterLocation {
  solarSystemId: number
  solarSystemName: string
  stationId?: number
  stationName?: string
  structureId?: number
}

export interface CharacterShip {
  typeId: number
  typeName: string
  name: string
}

export interface CharacterSkillsSummary {
  totalSp: number
  unallocatedSp: number
}

export async function getCharacterLocation(characterId: number): Promise<CharacterLocation> {
  const authorization = await getCharacterAuthorization(characterId, locationScope)
  const position = (
    await getEsiResilienceLayer().get({
      operation: 'location',
      resource: `location-${characterId}`,
      principal: `character-${characterId}`,
      load: (revalidation) =>
        createLocationClient({
          fetch: createEsiTransport('location', `character-${characterId}`),
          token: authorization.accessToken,
        })
          .withMetadata()
          .get(characterId, revalidation),
    })
  ).data

  const [system, station] = await Promise.all([
    getEsiResilienceLayer().get({
      operation: 'universe-solar-system',
      resource: `solar-system-${position.solar_system_id}`,
      load: (revalidation) =>
        createUniverseClient({ fetch: createEsiTransport('universe-solar-system') })
          .withMetadata()
          .getSolarSystem(position.solar_system_id, revalidation),
    }),
    position.station_id
      ? getEsiResilienceLayer().get({
          operation: 'universe-station',
          resource: `station-${position.station_id}`,
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
  }
}

export async function getCharacterShip(characterId: number): Promise<CharacterShip> {
  const authorization = await getCharacterAuthorization(characterId, shipScope)
  const ship = (
    await getEsiResilienceLayer().get({
      operation: 'ship',
      resource: `ship-${characterId}`,
      principal: `character-${characterId}`,
      load: (revalidation) =>
        createLocationClient({
          fetch: createEsiTransport('ship', `character-${characterId}`),
          token: authorization.accessToken,
        })
          .withMetadata()
          .getCurrentShip(characterId, revalidation),
    })
  ).data
  const type = (
    await getEsiResilienceLayer().get({
      operation: 'universe-type',
      resource: `type-${ship.ship_type_id}`,
      load: (revalidation) =>
        createUniverseClient({ fetch: createEsiTransport('universe-type') })
          .withMetadata()
          .getType(ship.ship_type_id, revalidation),
    })
  ).data

  return {
    typeId: ship.ship_type_id,
    typeName: type.name,
    name: ship.ship_name,
  }
}

export async function getCharacterSkillsSummary(
  characterId: number,
): Promise<CharacterSkillsSummary> {
  const skills = await getCharacterSkillsData(characterId)
  return { totalSp: skills.total_sp, unallocatedSp: skills.unallocated_sp ?? 0 }
}
