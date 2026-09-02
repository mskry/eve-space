import { Hono } from 'hono'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { deleteCharacter, listUserCharacters, setMainCharacter } from '../auth/store.js'
import { characterAttributesScope, getCharacterAttributes } from './attributes.js'
import {
  characterContractsScope,
  ContractNotFoundError,
  ContractQuotaError,
  getCharacterContractBids,
  getCharacterContractItems,
  getCharacterContracts,
} from './contracts.js'
import { getCharacterEmploymentHistory } from './history.js'
import {
  getCharacterMarketOrderHistory,
  getCharacterMarketOrders,
  MarketQuotaError,
  marketOrdersScope,
} from './market.js'
import { characterSkillQueueScope, getCharacterSkillQueue } from './skill-queue.js'
import { characterSkillsScope, getCharacterSkills } from './skills.js'
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
import {
  getWalletBalance,
  getWalletJournal,
  getWalletTransactions,
  walletScope,
  WalletQuotaError,
} from './wallet.js'
import { env } from '../env.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { combineEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/tokens.js'
import { zValidator } from '../http/validation.js'

type Section<Data> =
  | { status: 'ok'; data: Data }
  | { status: 'scope-required'; message: string; requiredScope: string; authorizeUrl: string }
  | { status: 'unavailable'; message: string }

const positiveIntegerString = (name: string) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, `${name} must be a positive integer.`)
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .positive(`${name} must be a positive integer.`)
        .max(Number.MAX_SAFE_INTEGER, `${name} must be a positive integer.`),
    )

const pageQuery = z.object({ page: positiveIntegerString('Page') }).strict()
const transactionQuery = z
  .object({ fromId: positiveIntegerString('Transaction continuation ID').optional() })
  .strict()
const contractParams = characterIdParams.extend({
  contractId: positiveIntegerString('Contract ID'),
})
const contractDetailQuery = z
  .object({ contractPage: positiveIntegerString('Contract page') })
  .strict()

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
  .get(
    '/:characterId/attributes',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getCharacterAttributes(characterId))
      } catch (error) {
        if (error instanceof EsiQuotaError) return esiCooldown(context, error)
        if (error instanceof TokenRefreshUnavailableError) return tokenRefreshUnavailable(context)
        if (error instanceof ScopeRequiredError) {
          return scopeRequired(
            context,
            characterId,
            'Authorize attributes access for this character.',
            error.scope,
          )
        }

        const status = errorStatus(error)
        if (status === 401 || status === 403) {
          return reauthorizationRequired(context, characterId, characterAttributesScope)
        }
        return context.json(
          { code: 'ESI_UNAVAILABLE', message: 'EVE Online ESI is temporarily unavailable.' },
          502,
        )
      }
    },
  )
  .get(
    '/:characterId/skill-queue',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getCharacterSkillQueue(characterId))
      } catch (error) {
        if (error instanceof EsiQuotaError) return esiCooldown(context, error)
        if (error instanceof TokenRefreshUnavailableError) return tokenRefreshUnavailable(context)
        if (error instanceof ScopeRequiredError) {
          return scopeRequired(
            context,
            characterId,
            'Authorize skill queue access for this character.',
            error.scope,
          )
        }

        const status = errorStatus(error)
        if (status === 401 || status === 403) {
          return reauthorizationRequired(context, characterId, characterSkillQueueScope)
        }
        return context.json(
          { code: 'ESI_UNAVAILABLE', message: 'EVE Online ESI is temporarily unavailable.' },
          502,
        )
      }
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
        if (error instanceof EsiQuotaError) return esiCooldown(context, error)
        if (error instanceof TokenRefreshUnavailableError) return tokenRefreshUnavailable(context)
        if (error instanceof ScopeRequiredError) {
          return scopeRequired(
            context,
            characterId,
            'Authorize skills access for this character.',
            error.scope,
          )
        }

        const status = errorStatus(error)
        if (status === 401 || status === 403) {
          return reauthorizationRequired(context, characterId, characterSkillsScope)
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
        return context.json({ characterId, ...(await getWalletBalance(characterId)) }, 200)
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: walletScope,
          scopeMessage: 'Authorize wallet access for this character.',
          quota: 'wallet',
          quotaMessage: 'ESI wallet quota is temporarily exhausted.',
          unavailableMessage: 'Unable to retrieve the EVE wallet balance.',
        })
      }
    },
  )
  .get(
    '/:characterId/wallet/journal',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('query', pageQuery),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(
          {
            characterId,
            ...(await getWalletJournal(characterId, context.req.valid('query').page)),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: walletScope,
          scopeMessage: 'Authorize wallet access for this character.',
          quota: 'wallet',
          quotaMessage: 'ESI wallet quota is temporarily exhausted.',
          unavailableMessage: 'Unable to retrieve the wallet journal.',
        })
      }
    },
  )
  .get(
    '/:characterId/wallet/transactions',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('query', transactionQuery),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(
          {
            characterId,
            ...(await getWalletTransactions(
              characterId,
              context.req.valid('query').fromId ?? null,
            )),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: walletScope,
          scopeMessage: 'Authorize wallet access for this character.',
          quota: 'wallet',
          quotaMessage: 'ESI wallet quota is temporarily exhausted.',
          unavailableMessage: 'Unable to retrieve wallet transactions.',
        })
      }
    },
  )
  .get(
    '/:characterId/market/orders',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json({ characterId, ...(await getCharacterMarketOrders(characterId)) }, 200)
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: marketOrdersScope,
          scopeMessage: 'Authorize market order access for this character.',
          quota: 'market',
          quotaMessage: 'ESI market quota is temporarily exhausted.',
          unavailableMessage: 'Unable to retrieve character market orders.',
        })
      }
    },
  )
  .get(
    '/:characterId/market/orders/history',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('query', pageQuery),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(
          {
            characterId,
            ...(await getCharacterMarketOrderHistory(characterId, context.req.valid('query').page)),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: marketOrdersScope,
          scopeMessage: 'Authorize market order access for this character.',
          quota: 'market',
          quotaMessage: 'ESI market quota is temporarily exhausted.',
          unavailableMessage: 'Unable to retrieve character market order history.',
        })
      }
    },
  )
  .get(
    '/:characterId/contracts',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('query', pageQuery),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(
          {
            characterId,
            ...(await getCharacterContracts(characterId, context.req.valid('query').page)),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: characterContractsScope,
          scopeMessage: 'Authorize contract access for this character.',
          quota: 'contract',
          quotaMessage: 'ESI contract quota is temporarily exhausted.',
          unavailableMessage: 'Unable to retrieve character contracts.',
        })
      }
    },
  )
  .get(
    '/:characterId/contracts/:contractId/items',
    privateNoStore,
    zValidator('param', contractParams),
    zValidator('query', contractDetailQuery),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      const { contractId } = context.req.valid('param')
      try {
        return context.json(
          {
            characterId,
            contractId,
            ...(await getCharacterContractItems(
              characterId,
              contractId,
              context.req.valid('query').contractPage,
            )),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: characterContractsScope,
          scopeMessage: 'Authorize contract access for this character.',
          quota: 'contract',
          quotaMessage: 'ESI contract quota is temporarily exhausted.',
          unavailableMessage: 'Unable to retrieve character contract items.',
          allowNotFound: true,
        })
      }
    },
  )
  .get(
    '/:characterId/contracts/:contractId/bids',
    privateNoStore,
    zValidator('param', contractParams),
    zValidator('query', contractDetailQuery),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      const { contractId } = context.req.valid('param')
      try {
        return context.json(
          {
            characterId,
            contractId,
            ...(await getCharacterContractBids(
              characterId,
              contractId,
              context.req.valid('query').contractPage,
            )),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: characterContractsScope,
          scopeMessage: 'Authorize contract access for this character.',
          quota: 'contract',
          quotaMessage: 'ESI contract quota is temporarily exhausted.',
          unavailableMessage: 'Unable to retrieve character contract bids.',
          allowNotFound: true,
        })
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
      } catch (error) {
        if (error instanceof EsiQuotaError) return esiCooldown(context, error)
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
    if (error instanceof TokenRefreshUnavailableError) {
      return { status: 'unavailable', message: 'EVE token refresh is temporarily unavailable.' }
    }
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

type FinanceQuotaKind = 'wallet' | 'market' | 'contract'

interface FinanceErrorOptions {
  requiredScope: string
  scopeMessage: string
  quota: FinanceQuotaKind
  quotaMessage: string
  unavailableMessage: string
  allowNotFound?: boolean
}

function financeError(
  context: Context,
  error: unknown,
  characterId: number,
  options: FinanceErrorOptions,
) {
  if (options.allowNotFound && error instanceof ContractNotFoundError) {
    return context.json(
      { code: 'CONTRACT_NOT_FOUND', message: 'Contract not found in the referenced page.' },
      404,
    )
  }
  if (error instanceof TokenRefreshUnavailableError) return tokenRefreshUnavailable(context)
  if (error instanceof ScopeRequiredError) {
    return context.json(
      {
        code: 'EVE_SCOPE_REQUIRED',
        message: options.scopeMessage,
        requiredScope: options.requiredScope,
        authorizeUrl: financeReauthorizationUrl(characterId),
      },
      403,
    )
  }

  const quotaError = financeQuotaError(error, options.quota)
  if (quotaError) {
    context.header('Retry-After', String(quotaError.retryAfterSeconds))
    return context.json(
      {
        code: 'ESI_QUOTA_EXHAUSTED',
        message: options.quotaMessage,
        retryAfterSeconds: quotaError.retryAfterSeconds,
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
        requiredScope: options.requiredScope,
        authorizeUrl: financeReauthorizationUrl(characterId),
      },
      403,
    )
  }

  return context.json({ code: 'ESI_UNAVAILABLE', message: options.unavailableMessage }, 502)
}

function financeQuotaError(error: unknown, kind: FinanceQuotaKind) {
  if (kind === 'wallet' && error instanceof WalletQuotaError) return error
  if (kind === 'market' && error instanceof MarketQuotaError) return error
  if (kind === 'contract' && error instanceof ContractQuotaError) return error
  return undefined
}

function tokenRefreshUnavailable(context: Context) {
  return context.json(
    {
      code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
      message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
    },
    503,
  )
}

function esiCooldown(context: Context, error: EsiQuotaError) {
  context.header('Retry-After', String(error.retryAfterSeconds))
  return context.json(
    {
      code: 'ESI_COOLDOWN',
      message: 'EVE Online ESI is temporarily rate limited.',
      retryAfterSeconds: error.retryAfterSeconds,
    },
    429,
  )
}

function scopeRequired(
  context: Context,
  characterId: number,
  message: string,
  requiredScope: string,
) {
  return context.json(
    {
      code: 'EVE_SCOPE_REQUIRED',
      message,
      requiredScope,
      authorizeUrl: reauthorizationUrl(characterId),
    },
    403,
  )
}

function reauthorizationRequired(context: Context, characterId: number, requiredScope: string) {
  return context.json(
    {
      code: 'EVE_REAUTH_REQUIRED',
      message: 'EVE authorization is no longer valid.',
      requiredScope,
      authorizeUrl: reauthorizationUrl(characterId),
    },
    403,
  )
}

function reauthorizationUrl(characterId: number) {
  return new URL(`/auth/eve/reauthorize/${characterId}`, env.EVE_CALLBACK_URL).toString()
}

function financeReauthorizationUrl(characterId: number) {
  const url = new URL(`/auth/eve/reauthorize/${characterId}`, env.EVE_CALLBACK_URL)
  url.searchParams.set('returnTo', `/characters/${characterId}/finance`)
  return url.toString()
}

function errorStatus(error: unknown) {
  return typeof error === 'object' && error && 'status' in error ? Number(error.status) : undefined
}

function setPrivateHeaders(context: Context) {
  context.header('Cache-Control', 'private, no-store')
  context.header('Vary', 'Cookie')
}
