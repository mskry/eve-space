import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersDetailResponse } from '@evespace/esi-client/types'
import { publicAllianceRepresentation } from '../alliances/public-data.js'
import { getCorporationPublicResult } from '../corporations/public-data.js'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { definePublicEsiRepresentation } from '../esi-resilience/representations.js'
import { combineEsiResultMetadata } from '../esi-resilience/result-metadata.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'
import { eveDescriptionToPlainText } from '../text/eve-description.js'

// Only the four empire races are playable. These are faction IDs, which the EVE image server
// serves as empire emblems under its corporations category.
const raceFactionIds: Record<number, number> = {
  1: 500_001, // Caldari State
  2: 500_002, // Minmatar Republic
  4: 500_003, // Amarr Empire
  8: 500_004, // Gallente Federation
}

interface PublicCharacterResult {
  name: string
  birthday: string
  gender: string
  raceId: number
  bloodlineId: number
  securityStatus: number
  achievementScore: number
  corporationId: number
  corporationTitle?: string
  description?: string
  factionId: number | null
  allianceId: number | null
}

interface PublicRaceResult {
  raceId: number
  name: string
}

interface PublicBloodlineResult {
  bloodlineId: number
  name: string
}

const publicCharacterRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'public-character',
    name: 'public-character-core',
    descriptor: operationRegistry.GetCharactersDetail.transport,
    encodeRequest: (input: { characterId: number }) => ({
      path: { character_id: input.characterId },
    }),
    map: (response): PublicCharacterResult => mapPublicCharacter(response.data),
  }),
)

const universeRacesRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'universe-races',
    name: 'universe-races-core',
    descriptor: operationRegistry.GetUniverseRaces.transport,
    encodeRequest: () => ({}),
    map: (response): PublicRaceResult[] =>
      response.data.map((race) => ({ raceId: race.race_id, name: race.name })),
  }),
)

const universeBloodlinesRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'universe-bloodlines',
    name: 'universe-bloodlines-core',
    descriptor: operationRegistry.GetUniverseBloodlines.transport,
    encodeRequest: () => ({}),
    map: (response): PublicBloodlineResult[] =>
      response.data.map((bloodline) => ({
        bloodlineId: bloodline.bloodline_id,
        name: bloodline.name,
      })),
  }),
)

interface CharacterProfileData {
  id: number
  name: string
  birthday: string
  gender: string
  race: string
  raceFactionId: number | null
  bloodline: string
  securityStatus: number
  achievementScore: number
  corporationTitle?: string
  bio?: string
  factionId: number | null
  corporation: {
    id: number
    name: string
    ticker: string
    memberCount: number
  }
  alliance: {
    id: number
    name: string
    ticker: string
  } | null
}

type CharacterProfile = CharacterProfileData & EsiResultMetadata

export async function getCharacterProfile(characterId: number) {
  const characterResult = await execute(publicCharacterRepresentation, { characterId })
  const character = characterResult.data
  const [corporationResult, races, bloodlines, alliance] = await Promise.all([
    getCorporationPublicResult(character.corporationId),
    execute(universeRacesRepresentation, {}),
    execute(universeBloodlinesRepresentation, {}),
    character.allianceId
      ? execute(publicAllianceRepresentation, { allianceId: character.allianceId })
      : Promise.resolve(null),
  ])

  const corporation = corporationResult.data
  const race = races.data.find((entry) => entry.raceId === character.raceId)
  const metadata = combineEsiResultMetadata([
    characterResult,
    corporationResult,
    races,
    bloodlines,
    ...(alliance ? [alliance] : []),
  ])

  const profile: CharacterProfile = {
    id: characterId,
    name: character.name,
    birthday: character.birthday,
    gender: character.gender,
    race: race?.name ?? 'Unknown',
    raceFactionId: raceFactionIds[character.raceId] ?? null,
    bloodline:
      bloodlines.data.find((bloodline) => bloodline.bloodlineId === character.bloodlineId)?.name ??
      'Unknown',
    securityStatus: character.securityStatus,
    achievementScore: character.achievementScore,
    corporationTitle: character.corporationTitle,
    bio: eveDescriptionToPlainText(character.description),
    // Militia allegiance; unset for characters outside Faction Warfare.
    factionId: character.factionId,
    corporation: {
      id: character.corporationId,
      name: corporation.name,
      ticker: corporation.ticker,
      memberCount: corporation.memberCount,
    },
    alliance:
      alliance && character.allianceId
        ? {
            id: character.allianceId,
            name: alliance.data.name,
            ticker: alliance.data.ticker,
          }
        : null,
    ...metadata,
  }

  return profile
}

export async function getCharacterAffiliation(characterId: number) {
  const result = await execute(publicCharacterRepresentation, { characterId })
  const character = result.data
  return {
    corporationId: character.corporationId,
    allianceId: character.allianceId,
    affiliationCheckedAt: new Date(result.validatedAt),
    stale: result.stale,
  }
}

function mapPublicCharacter(character: GetCharactersDetailResponse): PublicCharacterResult {
  return {
    name: character.name,
    birthday: character.birthday,
    gender: character.gender,
    raceId: character.race_id,
    bloodlineId: character.bloodline_id,
    securityStatus: character.security_status ?? 0,
    achievementScore: character.achievement_score,
    corporationId: character.corporation_id,
    corporationTitle: character.corporation_title,
    description: character.description,
    factionId: character.faction_id ?? null,
    allianceId: character.alliance_id ?? null,
  }
}
