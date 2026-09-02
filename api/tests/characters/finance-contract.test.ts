import { hc, type InferRequestType, type InferResponseType } from 'hono/client'
import { describe, expectTypeOf, test } from 'vitest'
import type { AppType } from '../../src/index.js'

const client = hc<AppType>('http://localhost:8788')
const character = client.api.me.characters[':characterId']
const wallet = character.wallet
const market = character.market
const contracts = character.contracts

type WalletJournalRequest = InferRequestType<(typeof wallet)['journal']['$get']>
type WalletTransactionRequest = InferRequestType<(typeof wallet)['transactions']['$get']>
type MarketHistoryRequest = InferRequestType<(typeof market)['orders']['history']['$get']>
type ContractsRequest = InferRequestType<(typeof contracts)['$get']>
type ContractItemsRequest = InferRequestType<(typeof contracts)[':contractId']['items']['$get']>

type WalletResponse = InferResponseType<(typeof wallet)['$get'], 200>
type WalletJournalResponse = InferResponseType<(typeof wallet)['journal']['$get'], 200>
type WalletTransactionsResponse = InferResponseType<(typeof wallet)['transactions']['$get'], 200>
type MarketOrdersResponse = InferResponseType<(typeof market)['orders']['$get'], 200>
type MarketHistoryResponse = InferResponseType<(typeof market)['orders']['history']['$get'], 200>
type ContractsResponse = InferResponseType<(typeof contracts)['$get'], 200>
type ContractItemsResponse = InferResponseType<
  (typeof contracts)[':contractId']['items']['$get'],
  200
>
type ContractBidsResponse = InferResponseType<
  (typeof contracts)[':contractId']['bids']['$get'],
  200
>

type WalletJournalEntry = WalletJournalResponse['entries'][number]
type WalletTransaction = WalletTransactionsResponse['transactions'][number]
type MarketOrder = MarketOrdersResponse['orders'][number]
type HistoricalMarketOrder = MarketHistoryResponse['orders'][number]
type CharacterContract = ContractsResponse['contracts'][number]
type ContractItem = ContractItemsResponse['items'][number]
type ContractBid = ContractBidsResponse['bids'][number]
type HasAnyKey<Value, Keys extends PropertyKey> = [Extract<keyof Value, Keys>] extends [never]
  ? false
  : true

describe('mounted Finance AppType contract', () => {
  test('retains canonical page, continuation, and contract-detail request identities', () => {
    expectTypeOf<WalletJournalRequest['query']>().toEqualTypeOf<{ page: string }>()
    expectTypeOf<WalletTransactionRequest['query']>().toEqualTypeOf<{ fromId?: string }>()
    expectTypeOf<MarketHistoryRequest['query']>().toEqualTypeOf<{ page: string }>()
    expectTypeOf<ContractsRequest['query']>().toEqualTypeOf<{ page: string }>()
    expectTypeOf<ContractItemsRequest['param']>().toEqualTypeOf<{
      characterId: string
      contractId: string
    }>()
    expectTypeOf<ContractItemsRequest['query']>().toEqualTypeOf<{ contractPage: string }>()
  })

  test('preserves nullable and pagination response semantics', () => {
    expectTypeOf<WalletResponse['balance']>().toEqualTypeOf<number>()
    expectTypeOf<WalletJournalEntry['amount']>().toEqualTypeOf<number | null>()
    expectTypeOf<WalletJournalEntry['balance']>().toEqualTypeOf<number | null>()
    expectTypeOf<WalletJournalEntry['reason']>().toEqualTypeOf<string | null>()
    expectTypeOf<WalletJournalEntry['taxAmount']>().toEqualTypeOf<number | null>()
    expectTypeOf<WalletJournalEntry['context']>().toMatchTypeOf<{
      id: number
      type: string
    } | null>()
    expectTypeOf<WalletJournalResponse['page']>().toEqualTypeOf<number>()
    expectTypeOf<WalletJournalResponse['totalPages']>().toEqualTypeOf<number>()
    expectTypeOf<WalletTransactionsResponse['fromId']>().toEqualTypeOf<number | null>()
    expectTypeOf<WalletTransactionsResponse['nextFromId']>().toEqualTypeOf<number | null>()
    expectTypeOf<MarketOrder['isBuy']>().toEqualTypeOf<boolean>()
    expectTypeOf<MarketOrder['minimumVolume']>().toEqualTypeOf<number | null>()
    expectTypeOf<MarketOrder['escrow']>().toEqualTypeOf<number | null>()
    expectTypeOf<HistoricalMarketOrder['state']>().toEqualTypeOf<'cancelled' | 'expired'>()
    expectTypeOf<MarketHistoryResponse['page']>().toEqualTypeOf<number>()
    expectTypeOf<MarketHistoryResponse['totalPages']>().toEqualTypeOf<number>()
    expectTypeOf<CharacterContract['acceptedAt']>().toEqualTypeOf<string | null>()
    expectTypeOf<CharacterContract['price']>().toEqualTypeOf<number | null>()
    expectTypeOf<ContractsResponse['page']>().toEqualTypeOf<number>()
    expectTypeOf<ContractsResponse['totalPages']>().toEqualTypeOf<number>()
    expectTypeOf<ContractItem['blueprint']>().toEqualTypeOf<'original' | 'copy' | null>()
    expectTypeOf<ContractItemsResponse['contractId']>().toEqualTypeOf<number>()
    expectTypeOf<ContractBidsResponse['contractId']>().toEqualTypeOf<number>()
  })

  test('omits raw ESI transport and counterparty fields from every Finance DTO', () => {
    expectTypeOf<
      HasAnyKey<WalletResponse, 'source' | 'quota' | 'data' | 'meta'>
    >().toEqualTypeOf<false>()
    expectTypeOf<
      HasAnyKey<
        WalletJournalEntry,
        | 'id'
        | 'ref_type'
        | 'first_party_id'
        | 'second_party_id'
        | 'tax_receiver_id'
        | 'firstPartyId'
        | 'secondPartyId'
        | 'taxReceiverId'
      >
    >().toEqualTypeOf<false>()
    expectTypeOf<
      HasAnyKey<
        WalletTransaction,
        | 'clientId'
        | 'isPersonal'
        | 'client_id'
        | 'is_personal'
        | 'transaction_id'
        | 'journal_ref_id'
      >
    >().toEqualTypeOf<false>()
    expectTypeOf<
      HasAnyKey<MarketOrder, 'isCorporation' | 'is_corporation' | 'order_id' | 'type_id'>
    >().toEqualTypeOf<false>()
    expectTypeOf<
      HasAnyKey<
        CharacterContract,
        | 'issuerId'
        | 'issuerCorporationId'
        | 'assigneeId'
        | 'acceptorId'
        | 'forCorporation'
        | 'issuer_id'
        | 'issuer_corporation_id'
        | 'assignee_id'
        | 'acceptor_id'
        | 'for_corporation'
      >
    >().toEqualTypeOf<false>()
    expectTypeOf<
      HasAnyKey<ContractItem, 'rawQuantity' | 'raw_quantity' | 'is_included' | 'record_id'>
    >().toEqualTypeOf<false>()
    expectTypeOf<
      HasAnyKey<ContractBid, 'bidderId' | 'bidder_id' | 'bid_id'>
    >().toEqualTypeOf<false>()
  })

  test('does not expose corporation or alliance Finance route families', () => {
    expectTypeOf<
      HasAnyKey<
        (typeof client.api.corporations)[':corporationId'],
        'finance' | 'wallet' | 'market' | 'contracts'
      >
    >().toEqualTypeOf<false>()
    expectTypeOf<HasAnyKey<typeof client.api, 'alliances'>>().toEqualTypeOf<false>()
  })
})
