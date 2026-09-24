import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersDetailResponse } from '@evespace/esi-client/types'
import { z } from 'zod'
import { getAlliancePublicResult } from '../alliances/public-data.js'
import { getCorporationPublicResult } from '../corporations/public-data.js'
import {
  combineEsiResultMetadata,
  createPublicEsiRead,
  type EsiResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { parseEveFormattedText, type EveFormattedText } from '../text/eve-formatted-text.js'

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

const publicCharacterCacheSchema = z.object({
  achievementScore: z.number(),
  allianceId: z.number().nullable(),
  birthday: z.string(),
  bloodlineId: z.number(),
  corporationId: z.number(),
  corporationTitle: z.string().optional(),
  description: z.string().optional(),
  factionId: z.number().nullable(),
  gender: z.string(),
  name: z.string(),
  raceId: z.number(),
  securityStatus: z.number(),
})
const publicRacesCacheSchema = z.array(z.object({ name: z.string(), raceId: z.number() }))
const publicBloodlinesCacheSchema = z.array(z.object({ bloodlineId: z.number(), name: z.string() }))

const publicCharacterRead = createPublicEsiRead({
  cacheSchema: publicCharacterCacheSchema,
  descriptor: operationRegistry.GetCharactersDetail.transport,
  encodeRequest: (input: { characterId: number }) => ({
    path: { character_id: input.characterId },
  }),
  map: (response): PublicCharacterResult => mapPublicCharacter(response.data),
  name: 'public-character-core',
  operation: 'public-character',
})

const universeRacesRead = createPublicEsiRead({
  cacheSchema: publicRacesCacheSchema,
  descriptor: operationRegistry.GetUniverseRaces.transport,
  encodeRequest: () => ({}),
  map: (response): PublicRaceResult[] =>
    response.data.map((race) => ({ raceId: race.race_id, name: race.name })),
  name: 'universe-races-core',
  operation: 'universe-races',
})

const universeBloodlinesRead = createPublicEsiRead({
  cacheSchema: publicBloodlinesCacheSchema,
  descriptor: operationRegistry.GetUniverseBloodlines.transport,
  encodeRequest: () => ({}),
  map: (response): PublicBloodlineResult[] =>
    response.data.map((bloodline) => ({
      bloodlineId: bloodline.bloodline_id,
      name: bloodline.name,
    })),
  name: 'universe-bloodlines-core',
  operation: 'universe-bloodlines',
})

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
  bio?: EveFormattedText
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
  const characterResult = await publicCharacterRead.execute({ characterId })
  const character = characterResult.data
  const [corporationResult, races, bloodlines, alliance] = await Promise.all([
    getCorporationPublicResult(character.corporationId),
    universeRacesRead.execute({}),
    universeBloodlinesRead.execute({}),
    character.allianceId ? getAlliancePublicResult(character.allianceId) : Promise.resolve(null),
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
    bio: parseEveFormattedText(character.description),
    // Militia allegiance; unset for characters outside Faction Warfare.
    factionId: character.factionId,
    corporation: {
      id: character.corporationId,
      memberCount: corporation.memberCount,
      name: corporation.name,
      ticker: corporation.ticker,
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
  const result = await publicCharacterRead.execute({ characterId })
  const character = result.data
  return {
    affiliationCheckedAt: new Date(result.validatedAt),
    allianceId: character.allianceId,
    corporationId: character.corporationId,
    stale: result.stale,
  }
}

function mapPublicCharacter(character: GetCharactersDetailResponse): PublicCharacterResult {
  return {
    achievementScore: character.achievement_score,
    allianceId: character.alliance_id ?? null,
    birthday: character.birthday,
    bloodlineId: character.bloodline_id,
    corporationId: character.corporation_id,
    corporationTitle: character.corporation_title,
    description: character.description,
    factionId: character.faction_id ?? null,
    gender: character.gender,
    name: character.name,
    raceId: character.race_id,
    securityStatus: character.security_status ?? 0,
  }
}
