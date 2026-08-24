import { createAllianceClient } from '@evespace/esi-client/domains/alliance'
import { createCharacterClient } from '@evespace/esi-client/domains/character'
import { createCorporationClient } from '@evespace/esi-client/domains/corporation'
import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { eveDescriptionToPlainText } from './eve-description.js'
import { getEsiResilienceLayer } from './esi-resilience/resilience.js'
import { createEsiTransport } from './esi-resilience/transport.js'
import { getEsiOperationPolicy } from './esi-resilience/policy.js'

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
  const character = (
    await getEsiResilienceLayer().get({
      operation: 'public-character',
      resource: `character-${characterId}`,
      load: (revalidation) =>
        createCharacterClient({ fetch: createEsiTransport('public-character') })
          .withMetadata()
          .getPublicInfo(characterId, revalidation),
    })
  ).data
  const [corporation, races, bloodlines, alliance] = await Promise.all([
    getEsiResilienceLayer().get({
      operation: 'public-corporation',
      resource: `corporation-${character.corporation_id}`,
      load: (revalidation) =>
        createCorporationClient({ fetch: createEsiTransport('public-corporation') })
          .withMetadata()
          .getPublicInfo(character.corporation_id, revalidation),
    }),
    getEsiResilienceLayer().get({
      operation: 'universe-races',
      resource: 'races',
      load: (revalidation) =>
        createUniverseClient({ fetch: createEsiTransport('universe-races') })
          .withMetadata()
          .listRaces(revalidation),
    }),
    getEsiResilienceLayer().get({
      operation: 'universe-bloodlines',
      resource: 'bloodlines',
      load: (revalidation) =>
        createUniverseClient({
          fetch: createEsiTransport('universe-bloodlines'),
          validateResponses: getEsiOperationPolicy('universe-bloodlines').validateResponses,
        })
          .withMetadata()
          .listBloodlines(revalidation),
    }),
    character.alliance_id
      ? getEsiResilienceLayer().get({
          operation: 'public-alliance',
          resource: `alliance-${character.alliance_id}`,
          load: (revalidation) =>
            createAllianceClient({ fetch: createEsiTransport('public-alliance') })
              .withMetadata()
              .getPublicInfo(character.alliance_id!, revalidation),
        })
      : Promise.resolve(null),
  ])

  const race = races.data.find((entry) => entry.race_id === character.race_id)

  const profile: CharacterProfile = {
    id: characterId,
    name: character.name,
    birthday: character.birthday,
    gender: character.gender,
    race: race?.name ?? 'Unknown',
    raceFactionId: raceFactionIds[character.race_id] ?? null,
    bloodline:
      bloodlines.data.find((bloodline) => bloodline.bloodline_id === character.bloodline_id)
        ?.name ?? 'Unknown',
    securityStatus: character.security_status ?? 0,
    achievementScore: character.achievement_score,
    corporationTitle: character.corporation_title,
    bio: eveDescriptionToPlainText(character.description),
    // Militia allegiance; unset for characters outside Faction Warfare.
    factionId: character.faction_id ?? null,
    corporation: {
      id: character.corporation_id,
      name: corporation.data.name,
      ticker: corporation.data.ticker,
      memberCount: corporation.data.member_count,
    },
    alliance:
      alliance && character.alliance_id
        ? {
            id: character.alliance_id,
            name: alliance.data.name,
            ticker: alliance.data.ticker,
          }
        : null,
  }

  return profile
}

export async function getCharacterAffiliation(characterId: number) {
  const character = (
    await getEsiResilienceLayer().get({
      operation: 'public-character',
      resource: `character-${characterId}`,
      load: (revalidation) =>
        createCharacterClient({ fetch: createEsiTransport('public-character') })
          .withMetadata()
          .getPublicInfo(characterId, revalidation),
    })
  ).data
  return {
    corporationId: character.corporation_id,
    allianceId: character.alliance_id ?? null,
  }
}
