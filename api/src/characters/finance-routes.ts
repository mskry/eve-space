import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import {
  characterContractsScope,
  ContractNotFoundError,
  getCharacterContractBids,
  getCharacterContractItems,
  getCharacterContracts,
} from './contracts.js'
import {
  getCharacterMarketOrderHistory,
  getCharacterMarketOrders,
  marketOrdersScope,
} from './market.js'
import { classifyCharacterResourceFailure } from './resource-failure.js'
import { ownedCharacterResourceError, toCharacterEsiResponse } from './route-responses.js'
import { getWalletBalance, getWalletJournal, getWalletTransactions, walletScope } from './wallet.js'

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

export const characterFinanceRoutes = new Hono<OwnedCharacterEnv>()
  .get(
    '/:characterId/wallet',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          {
            characterId,
            ...toCharacterEsiResponse(await getWalletBalance(characterId, subjectLifecycleId)),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: walletScope,
          scopeMessage: 'Authorize wallet access for this character.',
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          {
            characterId,
            ...toCharacterEsiResponse(
              await getWalletJournal(
                characterId,
                context.req.valid('query').page,
                subjectLifecycleId,
              ),
            ),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: walletScope,
          scopeMessage: 'Authorize wallet access for this character.',
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          {
            characterId,
            ...toCharacterEsiResponse(
              await getWalletTransactions(
                characterId,
                context.req.valid('query').fromId ?? null,
                subjectLifecycleId,
              ),
            ),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: walletScope,
          scopeMessage: 'Authorize wallet access for this character.',
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          {
            characterId,
            ...toCharacterEsiResponse(
              await getCharacterMarketOrders(characterId, subjectLifecycleId),
            ),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: marketOrdersScope,
          scopeMessage: 'Authorize market order access for this character.',
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          {
            characterId,
            ...toCharacterEsiResponse(
              await getCharacterMarketOrderHistory(
                characterId,
                context.req.valid('query').page,
                subjectLifecycleId,
              ),
            ),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: marketOrdersScope,
          scopeMessage: 'Authorize market order access for this character.',
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          {
            characterId,
            ...toCharacterEsiResponse(
              await getCharacterContracts(
                characterId,
                context.req.valid('query').page,
                subjectLifecycleId,
              ),
            ),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: characterContractsScope,
          scopeMessage: 'Authorize contract access for this character.',
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      const { contractId } = context.req.valid('param')
      try {
        return context.json(
          {
            characterId,
            contractId,
            ...toCharacterEsiResponse(
              await getCharacterContractItems(
                characterId,
                contractId,
                context.req.valid('query').contractPage,
                subjectLifecycleId,
              ),
            ),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: characterContractsScope,
          scopeMessage: 'Authorize contract access for this character.',
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
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      const { contractId } = context.req.valid('param')
      try {
        return context.json(
          {
            characterId,
            contractId,
            ...toCharacterEsiResponse(
              await getCharacterContractBids(
                characterId,
                contractId,
                context.req.valid('query').contractPage,
                subjectLifecycleId,
              ),
            ),
          },
          200,
        )
      } catch (error) {
        return financeError(context, error, characterId, {
          requiredScope: characterContractsScope,
          scopeMessage: 'Authorize contract access for this character.',
          quotaMessage: 'ESI contract quota is temporarily exhausted.',
          unavailableMessage: 'Unable to retrieve character contract bids.',
          allowNotFound: true,
        })
      }
    },
  )

interface FinanceErrorOptions {
  requiredScope: string
  scopeMessage: string
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
  return ownedCharacterResourceError(
    context,
    classifyCharacterResourceFailure(error, {
      configuredScope: options.requiredScope,
      preferConfiguredScope: true,
    }),
    characterId,
    {
      scopeMessage: options.scopeMessage,
      unavailableMessage: options.unavailableMessage,
      cooldownMessage: options.quotaMessage,
      returnTo: `/characters/${characterId}/finance`,
    },
  )
}
