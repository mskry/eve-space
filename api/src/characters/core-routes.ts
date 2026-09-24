import { Hono } from 'hono'
import {
  deleteCharacter,
  listUserCharacters,
  setMainCharacter,
} from '../auth/character-lifecycle.js'
import { combineEsiResultMetadata } from '../esi-gateway/feature-execution.js'
import type { EsiReadResultMetadata } from '../esi-gateway/feature-execution.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { getCharacterLocation, getCharacterShip, locationScope, shipScope } from './overview.js'
import type { CharacterLocation, CharacterShip } from './overview.js'
import { getCharacterProfile } from './profile.js'
import { classifyCharacterResourceFailure } from './resource-failure.js'
import { characterReauthorizationUrl, toCharacterEsiResponse } from './route-responses.js'
import {
  characterSkillsScope,
  getCharacterSkillsSummary,
  type CharacterSkillsSummary,
} from './skills.js'
import { getWalletBalance } from './wallet.js'

const rosterEnrichmentTimeoutMs = 2000

type Section<Data> =
  | { status: 'ok'; data: Data }
  | { status: 'scope-required'; message: string; requiredScope: string; authorizeUrl: string }
  | { status: 'unavailable'; message: string }

export const characterCoreRoutes = new Hono<OwnedCharacterEnv>()
  .get('/', privateNoStore, loadSession, async (context) => {
    const session = context.var.session
    if (!session) {
      return context.json({ code: 'AUTH_REQUIRED', message: 'Log in with EVE Online first.' }, 401)
    }

    const characters = await listUserCharacters(session.userId)
    const [profiles, locations, ships, wallets, skillSummaries] = await Promise.all([
      Promise.all(
        characters.map((character) =>
          loadRosterEnrichment(() => getCharacterProfile(character.characterId)),
        ),
      ),
      Promise.all(
        characters.map((character) =>
          loadRosterEnrichment(() =>
            getCharacterLocation(character.characterId, character.subjectLifecycleId),
          ),
        ),
      ),
      Promise.all(
        characters.map((character) =>
          loadRosterEnrichment(() =>
            getCharacterShip(character.characterId, character.subjectLifecycleId),
          ),
        ),
      ),
      Promise.all(
        characters.map((character) =>
          loadRosterEnrichment(() =>
            getWalletBalance(character.characterId, character.subjectLifecycleId),
          ),
        ),
      ),
      Promise.all(
        characters.map((character) =>
          loadRosterEnrichment(() =>
            getCharacterSkillsSummary(character.characterId, character.subjectLifecycleId),
          ),
        ),
      ),
    ])
    return context.json({
      characters: characters.map((character, index) => ({
        alliance: character.allianceId
          ? {
              id: character.allianceId,
              name: profiles[index]?.alliance?.name ?? 'Unknown alliance',
            }
          : null,
        allianceId: character.allianceId,
        birthday: profiles[index]?.birthday ?? null,
        characterId: character.characterId,
        corporation: {
          id: character.corporationId,
          name: profiles[index]?.corporation.name ?? 'Unknown corporation',
        },
        corporationId: character.corporationId,
        isMain: character.isMain,
        location: locations[index] ? toCharacterEsiResponse(locations[index]) : null,
        name: character.name,
        raceFactionId: profiles[index]?.raceFactionId ?? null,
        securityStatus: profiles[index]?.securityStatus ?? null,
        ship: ships[index] ? toCharacterEsiResponse(ships[index]) : null,
        totalSp: skillSummaries[index]?.totalSp ?? null,
        walletBalance: wallets[index]?.balance ?? null,
      })),
    })
  })
  .get(
    '/:characterId',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      const [profile, location, ship, skills] = await Promise.all([
        getCharacterProfile(characterId).catch(() => undefined),
        resolveSection<CharacterLocation>(
          () => getCharacterLocation(characterId, subjectLifecycleId),
          locationScope,
          characterId,
        ),
        resolveSection<CharacterShip>(
          () => getCharacterShip(characterId, subjectLifecycleId),
          shipScope,
          characterId,
        ),
        resolveSection<CharacterSkillsSummary>(
          () => getCharacterSkillsSummary(characterId, subjectLifecycleId),
          characterSkillsScope,
          characterId,
        ),
      ])

      if (!profile) {
        return context.json(
          { message: 'EVE Online ESI is temporarily unavailable. Try again shortly.' },
          502,
        )
      }
      const metadata = combineEsiResultMetadata([
        profile,
        ...(location.status === 'ok' ? [location.data] : []),
        ...(ship.status === 'ok' ? [ship.data] : []),
        ...(skills.status === 'ok' ? [skills.data] : []),
      ])
      return context.json({
        location: toPublicEsiSection(location),
        profile,
        ship: toPublicEsiSection(ship),
        skills: toPublicEsiSection(skills),
        ...metadata,
      })
    },
  )
  .patch(
    '/:characterId/main',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const session = context.var.session!
      const mainCharacter = await setMainCharacter(
        session.userId,
        context.var.ownedCharacter.characterId,
      )
      if (!mainCharacter) {
        return context.json({ code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' }, 404)
      }
      return context.json({ mainCharacter })
    },
  )
  .delete(
    '/:characterId',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const result = await deleteCharacter(
        context.var.session!.userId,
        context.var.ownedCharacter.characterId,
        context.var.ownedCharacter.subjectLifecycleId,
      )
      if (result === 'main-character') {
        return context.json(
          {
            code: 'MAIN_CHARACTER_DELETE_FORBIDDEN',
            message: 'Choose another main character before deleting this one.',
          },
          409,
        )
      }
      if (result === 'authority-evidence') {
        return context.json(
          {
            code: 'CHARACTER_AUTHORITY_EVIDENCE_RETAINED',
            message:
              'This character supplies retained organization-owner authority evidence and cannot be deleted.',
          },
          409,
        )
      }
      if (result === 'corporation-source') {
        return context.json(
          {
            code: 'CHARACTER_CORPORATION_SOURCE_ACTIVE',
            message: 'Replace this character as the corporation data source before deleting it.',
          },
          409,
        )
      }
      if (result === 'not-found') {
        return context.json({ code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' }, 404)
      }
      return context.body(null, 204)
    },
  )

async function loadRosterEnrichment<Data>(load: () => Promise<Data>): Promise<Data | undefined> {
  let cancelTimeout: (() => void) | undefined
  const unavailable = new Promise<undefined>((resolve) => {
    const timeout = setTimeout(resolve, rosterEnrichmentTimeoutMs)
    cancelTimeout = () => clearTimeout(timeout)
  })

  try {
    return await Promise.race([load().catch(() => undefined), unavailable])
  } finally {
    cancelTimeout?.()
  }
}

async function resolveSection<Data>(
  load: () => Promise<Data>,
  requiredScope: string,
  characterId: number,
): Promise<Section<Data>> {
  try {
    return { data: await load(), status: 'ok' }
  } catch (error) {
    const failure = classifyCharacterResourceFailure(error, { configuredScope: requiredScope })
    switch (failure.kind) {
      case 'token-refresh-unavailable':
        return { message: 'EVE token refresh is temporarily unavailable.', status: 'unavailable' }
      case 'scope-required':
        return {
          authorizeUrl: characterReauthorizationUrl(characterId),
          message: `Authorize this scope to view this data: ${failure.requiredScope}`,
          requiredScope: failure.requiredScope,
          status: 'scope-required',
        }
      case 'authorization-rejected':
        return {
          authorizeUrl: characterReauthorizationUrl(characterId),
          message: 'EVE authorization is no longer valid.',
          requiredScope: failure.requiredScope,
          status: 'scope-required',
        }
      case 'cooldown':
      case 'unavailable':
        return { message: 'EVE Online ESI is temporarily unavailable.', status: 'unavailable' }
    }
  }
}

function toPublicEsiSection<Data extends EsiReadResultMetadata>(
  section: Section<Data>,
): Section<Omit<Data, 'source' | 'quota'>> {
  return section.status === 'ok'
    ? { data: toCharacterEsiResponse(section.data), status: 'ok' }
    : section
}
