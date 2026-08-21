import { createLocationClient } from '@evespace/esi-client/domains/location'
import { createSkillsClient } from '@evespace/esi-client/domains/skills'
import { EsiClient } from '@evespace/esi-client'
import { esiFetch } from './esi-fetch.js'
import { createCharacterResourceCache } from './esi-cache.js'
import { getCharacterAccessToken } from './token-service.js'

export const locationScope = 'esi-location.read_location.v1'
export const shipScope = 'esi-location.read_ship_type.v1'
export const skillsScope = 'esi-skills.read_skills.v1'

const esi = new EsiClient({ fetch: esiFetch })

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
  const accessToken = await getCharacterAccessToken(characterId, locationScope)
  const location = createLocationClient({ fetch: esiFetch, token: accessToken })
  const position = await location.get(characterId)

  const [system, station] = await Promise.all([
    esi.universe.getSolarSystem(position.solar_system_id),
    position.station_id ? esi.universe.getStation(position.station_id) : Promise.resolve(undefined),
  ])

  return {
    solarSystemId: position.solar_system_id,
    solarSystemName: system.name,
    ...(position.station_id ? { stationId: position.station_id, stationName: station?.name } : {}),
    ...(position.structure_id ? { structureId: position.structure_id } : {}),
  }
}

export async function getCharacterShip(characterId: number): Promise<CharacterShip> {
  const accessToken = await getCharacterAccessToken(characterId, shipScope)
  const location = createLocationClient({ fetch: esiFetch, token: accessToken })
  const ship = await location.getCurrentShip(characterId)
  const type = await esi.universe.getType(ship.ship_type_id)

  return {
    typeId: ship.ship_type_id,
    typeName: type.name,
    name: ship.ship_name,
  }
}

const skillsSummaryCache = createCharacterResourceCache<CharacterSkillsSummary>({
  scope: skillsScope,
  load: async (characterId, accessToken, revalidation) => {
    const skills = createSkillsClient({ fetch: esiFetch, token: accessToken })
    const response = await skills.withMetadata().getSkills(characterId, revalidation)

    return {
      data: {
        totalSp: response.data.total_sp,
        unallocatedSp: response.data.unallocated_sp ?? 0,
      },
      meta: response.meta,
    }
  },
})

export async function getCharacterSkillsSummary(
  characterId: number,
): Promise<CharacterSkillsSummary> {
  const result = await skillsSummaryCache.get(characterId)
  return result.data
}
