import { Hono } from 'hono'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { deleteCharacter, listUserCharacters, setMainCharacter } from '../auth-store.js'
import { getCharacterEmploymentHistory } from '../character-history-service.js'
import { characterSkillsScope, getCharacterSkills } from '../character-skills-service.js'
import {
  getCharacterLocation,
  getCharacterShip,
  getCharacterSkillsSummary,
  locationScope,
  shipScope,
  skillsScope,
} from '../character-overview-service.js'
import type {
  CharacterLocation,
  CharacterShip,
  CharacterSkillsSummary,
} from '../character-overview-service.js'
import { getCharacterProfile } from '../character-profile.js'
import {
  getWalletBalance,
  getWalletTransactions,
  walletScope,
  WalletQuotaError,
} from '../wallet-service.js'
import { env } from '../env.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { ScopeRequiredError } from '../token-service.js'
import { zValidator } from '../validation.js'

type Section<Data> =
  | { status: 'ok'; data: Data }
  | { status: 'scope-required'; message: string; requiredScope: string; authorizeUrl: string }
  | { status: 'unavailable'; message: string }

const privateNoStore = createMiddleware(async (context, next) => {
  setPrivateHeaders(context)
  await next()
})

export const characterRoutes = new Hono<OwnedCharacterEnv>()
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
      return context.json({ profile, location, ship, skills })
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
  .get(
    '/:characterId/skills',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getCharacterSkills(characterId))
      } catch (error) {
        if (error instanceof ScopeRequiredError) {
          return context.json(
            {
              code: 'EVE_SCOPE_REQUIRED',
              message: 'Authorize skills access for this character.',
              requiredScope: error.scope,
              authorizeUrl: reauthorizationUrl(characterId),
            },
            403,
          )
        }

        const status = errorStatus(error)
        if (status === 401 || status === 403) {
          return context.json(
            {
              code: 'EVE_REAUTH_REQUIRED',
              message: 'EVE authorization is no longer valid.',
              requiredScope: characterSkillsScope,
              authorizeUrl: reauthorizationUrl(characterId),
            },
            403,
          )
        }
        return context.json(
          { code: 'ESI_UNAVAILABLE', message: 'EVE Online ESI is temporarily unavailable.' },
          502,
        )
      }
    },
  )
  .get(
    '/:characterId/wallet',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        const wallet = await getWalletBalance(characterId)
        const maxAge = wallet.stale
          ? 0
          : Math.max(0, Math.floor((Date.parse(wallet.cachedUntil) - Date.now()) / 1_000))
        context.header('Cache-Control', `private, max-age=${maxAge}`)
        return context.json({ characterId, ...wallet })
      } catch (error) {
        if (error instanceof ScopeRequiredError) {
          return context.json(
            {
              code: 'EVE_SCOPE_REQUIRED',
              message: 'Authorize wallet access for this character.',
              requiredScope: error.scope,
              authorizeUrl: reauthorizationUrl(characterId),
            },
            403,
          )
        }
        if (error instanceof WalletQuotaError) {
          context.header('Retry-After', String(error.retryAfterSeconds))
          return context.json(
            {
              code: 'ESI_QUOTA_EXHAUSTED',
              message: 'ESI wallet quota is temporarily exhausted.',
              retryAfterSeconds: error.retryAfterSeconds,
            },
            429,
          )
        }
        const status = errorStatus(error)
        if (status === 401 || status === 403) {
          return context.json(
            {
              code: 'EVE_REAUTH_REQUIRED',
              message: 'EVE authorization is no longer valid.',
              requiredScope: walletScope,
              authorizeUrl: reauthorizationUrl(characterId),
            },
            403,
          )
        }
        return context.json(
          { code: 'ESI_UNAVAILABLE', message: 'Unable to retrieve the EVE wallet balance.' },
          502,
        )
      }
    },
  )
  .get(
    '/:characterId/wallet/transactions',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        const wallet = await getWalletTransactions(characterId)
        const maxAge = wallet.stale
          ? 0
          : Math.max(0, Math.floor((Date.parse(wallet.cachedUntil) - Date.now()) / 1_000))
        context.header('Cache-Control', `private, max-age=${maxAge}`)
        return context.json({ characterId, ...wallet })
      } catch (error) {
        if (error instanceof ScopeRequiredError) {
          return context.json(
            {
              code: 'EVE_SCOPE_REQUIRED',
              message: 'Authorize wallet access for this character.',
              requiredScope: error.scope,
              authorizeUrl: reauthorizationUrl(characterId),
            },
            403,
          )
        }
        if (error instanceof WalletQuotaError) {
          context.header('Retry-After', String(error.retryAfterSeconds))
          return context.json(
            {
              code: 'ESI_QUOTA_EXHAUSTED',
              message: 'ESI wallet quota is temporarily exhausted.',
              retryAfterSeconds: error.retryAfterSeconds,
            },
            429,
          )
        }
        const status = errorStatus(error)
        if (status === 401 || status === 403) {
          return context.json(
            {
              code: 'EVE_REAUTH_REQUIRED',
              message: 'EVE authorization is no longer valid.',
              requiredScope: walletScope,
              authorizeUrl: reauthorizationUrl(characterId),
            },
            403,
          )
        }
        return context.json(
          { code: 'ESI_UNAVAILABLE', message: 'Unable to retrieve wallet transactions.' },
          502,
        )
      }
    },
  )
  .get(
    '/:characterId/history',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json({
          characterId,
          history: await getCharacterEmploymentHistory(characterId),
        })
      } catch {
        return context.json(
          { code: 'ESI_UNAVAILABLE', message: 'Employment history is temporarily unavailable.' },
          502,
        )
      }
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
    if (error instanceof ScopeRequiredError) {
      return {
        status: 'scope-required',
        message: `Authorize this scope to view this data: ${error.scope}`,
        requiredScope: error.scope,
        authorizeUrl: reauthorizationUrl(characterId),
      }
    }
    const status = errorStatus(error)
    if (status === 401 || status === 403) {
      return {
        status: 'scope-required',
        message: 'EVE authorization is no longer valid.',
        requiredScope,
        authorizeUrl: reauthorizationUrl(characterId),
      }
    }
    return { status: 'unavailable', message: 'EVE Online ESI is temporarily unavailable.' }
  }
}

function reauthorizationUrl(characterId: number) {
  return new URL(`/auth/eve/reauthorize/${characterId}`, env.EVE_CALLBACK_URL).toString()
}

function errorStatus(error: unknown) {
  return typeof error === 'object' && error && 'status' in error ? Number(error.status) : undefined
}

function setPrivateHeaders(context: Context) {
  context.header('Cache-Control', 'private, no-store')
  context.header('Vary', 'Cookie')
}
