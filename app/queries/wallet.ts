import { defineQueryOptions } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { ApiQueryError, toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

interface WalletQueryParameters {
  apiClient: ApiClient
  characterId: number
}

export const walletQuery = defineQueryOptions(
  ({ apiClient, characterId }: WalletQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.wallet(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].wallet.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Wallet balance is unavailable.')
      }
      const wallet = await response.json()
      if (wallet.characterId !== characterId) {
        throw new ApiQueryError('Wallet response did not match the selected character.', {
          status: 409,
          code: 'WALLET_IDENTITY_MISMATCH',
        })
      }
      return wallet
    },
    ...QUERY_POLICY.wallet,
  }),
)

export const walletTransactionsQuery = defineQueryOptions(
  ({ apiClient, characterId }: WalletQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.walletTransactions(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].wallet.transactions.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Wallet transactions are unavailable.')
      }
      const wallet = await response.json()
      if (wallet.characterId !== characterId) {
        throw new ApiQueryError('Transaction response did not match the selected character.', {
          status: 409,
          code: 'WALLET_IDENTITY_MISMATCH',
        })
      }
      return wallet
    },
    ...QUERY_POLICY.walletTransactions,
  }),
)
