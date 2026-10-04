import { executeTypedGraphQL } from '@eve-space/platform-module-nuxt/runtime'
import {
  TradingPersonalInventoryDocument,
  TradingCorporationInventoryDocument,
  TradingCorporationHoldersDocument,
  type TradingPersonalInventoryQuery,
} from '../../src/runtime/app/trading-graphql.js'

void executeTypedGraphQL('https://api.example.test', TradingPersonalInventoryDocument, {
  characterIds: ['90000001', '90000002'],
  first: 20,
  after: null,
  filters: null,
})
void executeTypedGraphQL('https://api.example.test', TradingCorporationInventoryDocument, {
  corporationId: '98000001',
  first: 20,
  after: null,
  filters: null,
})
// @ts-expect-error A corporation read must have an exact corporation selector.
void executeTypedGraphQL('https://api.example.test', TradingCorporationInventoryDocument, {})
void executeTypedGraphQL('https://api.example.test', TradingCorporationHoldersDocument, {
  corporationId: '98000001',
  groupKey: 'opaque',
  first: 20,
  after: null,
})
void executeTypedGraphQL('https://api.example.test', TradingCorporationHoldersDocument, {
  // @ts-expect-error IDs preserve their exact string representation.
  corporationId: 98000001,
  groupKey: 'opaque',
  first: 20,
  after: null,
})
const selected = (result: TradingPersonalInventoryQuery) => {
  const quantity: string | undefined =
    result.trading?.personalInventory?.groups.rows[0]?.currentQuantity
  // @ts-expect-error Exact quantities cannot be assigned to floating-point numbers.
  const rounded: number | undefined = quantity
  // @ts-expect-error Unselected holder rows are excluded from the groups operation result.
  void result.trading?.personalInventory?.holders
  return rounded
}
void selected
