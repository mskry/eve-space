import { Hono } from 'hono'
import { deleteCharacter, listUserCharacters, setMainCharacter } from '../auth/store.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/tokens.js'
import { combineEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import {
  getCharacterLocation,
  getCharacterShip,
  getCharacterSkillsSummary,
  locationScope,
  shipScope,
  skillsScope,
} from './overview.js'
import type { CharacterLocation, CharacterShip, CharacterSkillsSummary } from './overview.js'
import { getCharacterProfile } from './profile.js'
import { characterReauthorizationUrl, errorStatus } from './route-responses.js'
import { getWalletBalance, walletScope } from './wallet.js'

type Section<Data> =
  | { status: 'ok'; data: Data }
  | { status: 'scope-required'; message: string; requiredScope: string; authorizeUrl: string }
  | { status: 'unavailable'; message: string }

export const characterCoreRoutes = new Hono<OwnedCharacterEnv>()
  .get('/', privateNoStore, loadSession, async (context) => {
    const session = context.var.session
    if (!session)
      return context.json({ code: 'AUTH_REQUIRED', message: 'Log in with EVE Online first.' }, 401)

    const characters = await listUserCharacters(session.userId)
    const [profiles, locations, ships, wallets, skillSummaries] = await Promise.all([
      Promise.all(
        characters.map((character) =>
          getCharacterProfile(character.characterId).catch(() => undefined),
        ),
      ),
      Promise.all(
        characters.map((character) =>
          resolveSection<CharacterLocation>(
            () => getCharacterLocation(character.characterId),
            locationScope,
            character.characterId,
          ),
        ),
      ),
      Promise.all(
        characters.map((character) =>
          resolveSection<CharacterShip>(
            () => getCharacterShip(character.characterId),
            shipScope,
            character.characterId,
          ),
        ),
      ),
      Promise.all(
        characters.map((character) =>
          resolveSection(
            () => getWalletBalance(character.characterId),
            walletScope,
            character.characterId,
          ),
        ),
      ),
      Promise.all(
        characters.map((character) =>
          resolveSection<CharacterSkillsSummary>(
            () => getCharacterSkillsSummary(character.characterId),
            skillsScope,
            character.characterId,
          ),
        ),
      ),
    ])
    return context.json({
      characters: characters.map((character, index) => ({
        characterId: character.characterId,
        name: character.name,
        corporationId: character.corporationId,
        allianceId: character.allianceId,
        isMain: character.isMain,
        birthday: profiles[index]?.birthday ?? null,
        securityStatus: profiles[index]?.securityStatus ?? null,
        raceFactionId: profiles[index]?.raceFactionId ?? null,
        location: locations[index]?.status === 'ok' ? locations[index].data : null,
        ship: ships[index]?.status === 'ok' ? ships[index].data : null,
        walletBalance: wallets[index]?.status === 'ok' ? wallets[index].data.balance : null,
        totalSp: skillSummaries[index]?.status === 'ok' ? skillSummaries[index].data.totalSp : null,
        corporation: {
          id: character.corporationId,
          name: profiles[index]?.corporation.name ?? 'Unknown corporation',
        },
        alliance: character.allianceId
          ? {
              id: character.allianceId,
              name: profiles[index]?.alliance?.name ?? 'Unknown alliance',
            }
          : null,
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
      const characterId = context.var.ownedCharacter.characterId
      const [profile, location, ship, skills] = await Promise.all([
        getCharacterProfile(characterId).catch(() => undefined),
        resolveSection<CharacterLocation>(
          () => getCharacterLocation(characterId),
          locationScope,
          characterId,
        ),
        resolveSection<CharacterShip>(() => getCharacterShip(characterId), shipScope, characterId),
        resolveSection<CharacterSkillsSummary>(
          () => getCharacterSkillsSummary(characterId),
          skillsScope,
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
      return context.json({ profile, location, ship, skills, ...metadata })
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
      if (!mainCharacter)
        return context.json({ code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' }, 404)
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
      if (result === 'not-found')
        return context.json({ code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' }, 404)
      return context.body(null, 204)
    },
  )

async function resolveSection<Data>(
  load: () => Promise<Data>,
  requiredScope: string,
  characterId: number,
): Promise<Section<Data>> {
  try {
    return { status: 'ok', data: await load() }
  } catch (error) {
    if (error instanceof TokenRefreshUnavailableError) {
      return { status: 'unavailable', message: 'EVE token refresh is temporarily unavailable.' }
    }
    if (error instanceof ScopeRequiredError) {
      return {
        status: 'scope-required',
        message: `Authorize this scope to view this data: ${error.scope}`,
        requiredScope: error.scope,
        authorizeUrl: characterReauthorizationUrl(characterId),
      }
    }
    const status = errorStatus(error)
    if (status === 401 || status === 403) {
      return {
        status: 'scope-required',
        message: 'EVE authorization is no longer valid.',
        requiredScope,
        authorizeUrl: characterReauthorizationUrl(characterId),
      }
    }
    return { status: 'unavailable', message: 'EVE Online ESI is temporarily unavailable.' }
  }
}
