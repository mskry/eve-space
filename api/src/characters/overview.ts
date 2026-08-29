import { createLocationClient } from '@evespace/esi-client/domains/location'
import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { getCharacterSkillsData } from './skills.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'

export const locationScope = getCharacterEsiScope('location')
export const shipScope = getCharacterEsiScope('ship')
export { characterSkillsScope as skillsScope } from './skills.js'

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
  const position = (
    await getEsiResilienceLayer().getCharacter({
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
  ).data

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
  }
}

export async function getCharacterShip(characterId: number): Promise<CharacterShip> {
  const ship = (
    await getEsiResilienceLayer().getCharacter({
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
  ).data
  const type = (
    await getEsiResilienceLayer().getPublic({
      operation: 'universe-type',
      inputs: { typeId: ship.ship_type_id },
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
  return { totalSp: skills.totalSp, unallocatedSp: skills.unallocatedSp }
}
