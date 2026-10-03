import {
  defineNonPersistentQueryOptions,
  executeTypedGraphQL,
} from '@eve-space/platform-module-nuxt/runtime'
import {
  MarketItemDocument,
  MarketOrderContinuationDocument,
  type MarketHistoryQuery,
  type MarketInitialOrdersQuery,
  type MarketOrderContinuationQueryVariables,
} from '../../src/runtime/app/market-graphql.js'

void executeTypedGraphQL('https://api.example.test', MarketItemDocument, {
  revision: 'revision',
  typeId: '587',
})
const continuation: MarketOrderContinuationQueryVariables = {
  profileId: 'profile',
  typeId: '587',
  observationId: 'observation',
  side: 'sell',
  after: 'opaque',
}
void executeTypedGraphQL('https://api.example.test', MarketOrderContinuationDocument, continuation)
void executeTypedGraphQL('https://api.example.test', MarketItemDocument, {
  revision: 'revision',
  // @ts-expect-error EVE ID inputs must retain their exact string representation.
  typeId: 587,
})
// @ts-expect-error Continuation requires the server's opaque cursor.
void executeTypedGraphQL('https://api.example.test', MarketOrderContinuationDocument, {
  profileId: 'profile',
  typeId: '587',
  observationId: 'observation',
  side: 'sell',
})
void executeTypedGraphQL('https://api.example.test', MarketOrderContinuationDocument, {
  ...continuation,
  // @ts-expect-error Only the schema's order sides are accepted.
  side: 'both',
})

const selectedValues = (orders: MarketInitialOrdersQuery, history: MarketHistoryQuery) => {
  const row = orders.market?.sellers?.rows[0]
  const price: string | undefined = row?.price
  const quantity: string | undefined = row?.volumeRemain
  const date: string | undefined = history.market?.history?.days[0]?.date
  // @ts-expect-error Exact decimal results cannot be treated as floating-point numbers.
  const roundedPrice: number | undefined = row?.price
  // @ts-expect-error Large integer results cannot be treated as JavaScript numbers.
  const roundedQuantity: number | undefined = row?.volumeRemain
  // @ts-expect-error Unselected fields are not part of the generated operation result.
  void orders.market?.referencePrices
  return { price, quantity, date, roundedPrice, roundedQuantity }
}
void selectedValues

const memoryQuery = defineNonPersistentQueryOptions(() => ({
  key: ['market', 'memory-fixture'],
  query: async () => 'value',
  gcTime: 300_000,
  esiPersistence: { kind: 'none' },
}))
void memoryQuery(undefined)
defineNonPersistentQueryOptions(() => ({
  key: ['market', 'invalid-persistence'],
  query: async () => 'value',
  // @ts-expect-error feature query options cannot grant browser persistence
  esiPersistence: { kind: 'public-esi' },
}))
