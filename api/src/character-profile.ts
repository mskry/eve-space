import { EsiClient } from '@evespace/esi-client'
import { esiFetch } from './esi-fetch.js'

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
    bio: toPlainText(character.description),
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

  if (cache.size >= 100) cache.delete(cache.keys().next().value ?? characterId)
  cache.set(characterId, { profile, expiresAt: Date.now() + 5 * 60 * 1000 })
  return profile
}

export async function getCharacterAffiliation(characterId: number) {
  const character = await esi.character.getPublicInfo(characterId)
  return {
    corporationId: character.corporation_id,
    allianceId: character.alliance_id ?? null,
  }
}

// EVE bios are user-authored HTML. The UI renders this as escaped text, so stripping markup here
// is purely cosmetic - it keeps font/color tags out of the visible string.
function toPlainText(html: string | undefined) {
  if (!html) return undefined
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const normalized = decodeLegacyUnicodeLiteral(text).trim()
  return normalized || undefined
}

function decodeLegacyUnicodeLiteral(value: string) {
  const literal = /^[uU](['"])([\s\S]*)\1$/.exec(value)
  if (!literal) return value

  const body = literal[2]!
  let decoded = ''
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!
    if (character !== '\\' || index === body.length - 1) {
      decoded += character
      continue
    }

    const escape = body[index + 1]!
    const digits = escape === 'u' ? 4 : escape === 'U' ? 8 : 0
    if (digits) {
      const hex = body.slice(index + 2, index + 2 + digits)
      if (hex.length === digits && /^[0-9a-f]+$/i.test(hex)) {
        const codePoint = Number.parseInt(hex, 16)
        if (digits === 4 || codePoint <= 0x10ffff) {
          decoded += digits === 4 ? String.fromCharCode(codePoint) : String.fromCodePoint(codePoint)
          index += digits + 1
          continue
        }
      }
    }

    const escapedCharacter =
      escape === 'n'
        ? '\n'
        : escape === 'r'
          ? '\r'
          : escape === 't'
            ? '\t'
            : escape === '\\' || escape === "'" || escape === '"'
              ? escape
              : undefined
    if (escapedCharacter !== undefined) {
      decoded += escapedCharacter
      index += 1
      continue
    }

    decoded += `\\${escape}`
    index += 1
  }
  return decoded
}
