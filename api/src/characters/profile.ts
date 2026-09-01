import { createAllianceClient } from '@evespace/esi-client/domains/alliance'
import { createCharacterClient } from '@evespace/esi-client/domains/character'
import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { getCorporationPublicResult } from '../corporations/public-data.js'
import { eveDescriptionToPlainText } from '../text/eve-description.js'
import { combineEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import { getEsiOperationContract } from '../esi-resilience/catalog.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'

// Only the four empire races are playable. These are faction IDs, which the EVE image server
// serves as empire emblems under its corporations category.
const raceFactionIds: Record<number, number> = {
  1: 500_001, // Caldari State
  2: 500_002, // Minmatar Republic
  4: 500_003, // Amarr Empire
  8: 500_004, // Gallente Federation
}

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
  const characterResult = await getEsiResilienceLayer().getPublic({
    operation: 'public-character',
    inputs: { characterId },
    load: (revalidation) =>
      createCharacterClient({ fetch: createEsiTransport('public-character') })
        .withMetadata()
        .getPublicInfo(characterId, revalidation),
  })
  const character = characterResult.data
  const [corporationResult, races, bloodlines, alliance] = await Promise.all([
    getCorporationPublicResult(character.corporation_id),
    getEsiResilienceLayer().getPublic({
      operation: 'universe-races',
      inputs: {},
      load: (revalidation) =>
        createUniverseClient({ fetch: createEsiTransport('universe-races') })
          .withMetadata()
          .listRaces(revalidation),
    }),
    getEsiResilienceLayer().getPublic({
      operation: 'universe-bloodlines',
      inputs: {},
      load: (revalidation) =>
        createUniverseClient({
          fetch: createEsiTransport('universe-bloodlines'),
          validateResponses:
            getEsiOperationContract('universe-bloodlines').responseValidation.kind === 'enabled',
        })
          .withMetadata()
          .listBloodlines(revalidation),
    }),
    character.alliance_id
      ? getEsiResilienceLayer().getPublic({
          operation: 'public-alliance',
          inputs: { allianceId: character.alliance_id },
          load: (revalidation) =>
            createAllianceClient({ fetch: createEsiTransport('public-alliance') })
              .withMetadata()
              .getPublicInfo(character.alliance_id!, revalidation),
        })
      : Promise.resolve(null),
  ])

  const corporation = corporationResult.data
  const race = races.data.find((entry) => entry.race_id === character.race_id)
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
      name: corporation.name,
      ticker: corporation.ticker,
      memberCount: corporation.memberCount,
    },
    alliance:
      alliance && character.alliance_id
        ? {
            id: character.alliance_id,
            name: alliance.data.name,
            ticker: alliance.data.ticker,
          }
        : null,
    ...metadata,
  }

  return profile
}

export async function getCharacterAffiliation(characterId: number) {
  const result = await getEsiResilienceLayer().getPublic({
    operation: 'public-character',
    inputs: { characterId },
    load: (revalidation) =>
      createCharacterClient({ fetch: createEsiTransport('public-character') })
        .withMetadata()
        .getPublicInfo(characterId, revalidation),
  })
  const character = result.data
  return {
    corporationId: character.corporation_id,
    allianceId: character.alliance_id ?? null,
    affiliationCheckedAt: new Date(result.validatedAt),
    stale: result.stale,
  }
}
