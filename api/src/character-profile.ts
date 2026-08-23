import { EsiClient } from '@evespace/esi-client'
import { env } from './env.js'
import { esiFetch } from './esi-fetch.js'
import { publicProfileCacheTtlMs } from './esi-policy.js'
import { eveDescriptionToPlainText } from './eve-description.js'

const esi = new EsiClient({ fetch: esiFetch })
// ESI currently returns nullable ship_type_id values that are stricter than the pinned bloodline schema.
const bloodlineEsi = new EsiClient({ fetch: esiFetch, validateResponses: false })
const cache = new Map<number, { expiresAt: number; profile: CharacterProfile }>()

// Only the four empire races are playable. These are faction IDs, which the EVE image server
// serves as empire emblems under its corporations category.
const raceFactionIds: Record<number, number> = {
  1: 500_001, // Caldari State
  2: 500_002, // Minmatar Republic
  4: 500_003, // Amarr Empire
  8: 500_004, // Gallente Federation
}

interface CharacterProfile {
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

export async function getCharacterProfile(characterId: number) {
  const cached = cache.get(characterId)
  if (cached && cached.expiresAt > Date.now()) return cached.profile

  const character = await esi.character.getPublicInfo(characterId)
  const [corporation, races, bloodlines, alliance] = await Promise.all([
    esi.corporation.getPublicInfo(character.corporation_id),
    esi.universe.listRaces(),
    bloodlineEsi.universe.listBloodlines(),
    character.alliance_id
      ? esi.alliance.getPublicInfo(character.alliance_id)
      : Promise.resolve(null),
  ])

  const race = races.find((entry) => entry.race_id === character.race_id)

  const profile: CharacterProfile = {
    id: characterId,
    name: character.name,
    birthday: character.birthday,
    gender: character.gender,
    race: race?.name ?? 'Unknown',
    raceFactionId: raceFactionIds[character.race_id] ?? null,
    bloodline:
      bloodlines.find((bloodline) => bloodline.bloodline_id === character.bloodline_id)?.name ??
      'Unknown',
    securityStatus: character.security_status ?? 0,
    achievementScore: character.achievement_score,
    corporationTitle: character.corporation_title,
    bio: eveDescriptionToPlainText(character.description),
    // Militia allegiance; unset for characters outside Faction Warfare.
    factionId: character.faction_id ?? null,
    corporation: {
      id: character.corporation_id,
      name: corporation.name,
      ticker: corporation.ticker,
      memberCount: corporation.member_count,
    },
    alliance:
      alliance && character.alliance_id
        ? {
            id: character.alliance_id,
            name: alliance.name,
            ticker: alliance.ticker,
          }
        : null,
  }

  if (cache.size >= env.ESI_CACHE_MAX_ENTRIES)
    cache.delete(cache.keys().next().value ?? characterId)
  cache.set(characterId, { profile, expiresAt: Date.now() + publicProfileCacheTtlMs })
  return profile
}

export async function getCharacterAffiliation(characterId: number) {
  const character = await esi.character.getPublicInfo(characterId)
  return {
    corporationId: character.corporation_id,
    allianceId: character.alliance_id ?? null,
  }
}
