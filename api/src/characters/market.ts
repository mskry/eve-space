import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetCharactersCharacterIdOrdersHistoryResponse,
  GetCharactersCharacterIdOrdersResponse,
} from '@evespace/esi-client/types'
import {
  createCharacterEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { financeLocationName, loadFinanceLocationNames } from './finance-location-names.js'
import { assertFinancePositiveSafeInteger, resolveFinanceTotalPages } from './finance-pagination.js'
import { financeTypeName, loadFinanceTypeNames } from './finance-type-names.js'

type EsiCharacterMarketOrder =
  | GetCharactersCharacterIdOrdersResponse[number]
  | GetCharactersCharacterIdOrdersHistoryResponse[number]

interface CharacterMarketOrder {
  orderId: number
  typeId: number
  typeName: string
  isBuy: boolean
  price: number
  volumeRemain: number
  volumeTotal: number
  minimumVolume: number | null
  escrow: number | null
  range: EsiCharacterMarketOrder['range']
  locationId: number
  locationName: string | null
  regionId: number
  issuedAt: string
  durationDays: number
  expiresAt: string
}

interface CharacterMarketOrdersRepresentationInput {
  characterId: number
  subjectLifecycleId: string
}

interface CharacterMarketOrdersData {
  orders: CharacterMarketOrder[]
}

type CharacterMarketOrdersResult = CharacterMarketOrdersData & EsiReadResultMetadata

const characterMarketOrdersRead = createCharacterEsiRead({
  operation: 'market-orders',
  name: 'market-orders-core',
  descriptor: operationRegistry.GetCharactersCharacterIdOrders.transport,
  encodeRequest: (input: CharacterMarketOrdersRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: async (response): Promise<CharacterMarketOrdersData> => {
    const personalOrders = response.data.filter((order) => !order.is_corporation)
    const [namesByType, namesByLocation] = await Promise.all([
      loadFinanceTypeNames(personalOrders.map((order) => order.type_id)),
      loadFinanceLocationNames(personalOrders.map((order) => order.location_id)),
    ])
    return {
      orders: personalOrders.map((order) => mapMarketOrder(order, namesByType, namesByLocation)),
    }
  },
})

export const marketOrdersScope = characterMarketOrdersRead.requiredScope

interface CharacterMarketOrderHistoryRepresentationInput {
  characterId: number
  page: number
  subjectLifecycleId: string
}

interface CharacterMarketOrderHistoryData {
  orders: Array<CharacterMarketOrder & { state: 'cancelled' | 'expired' }>
  page: number
  totalPages: number
}

type CharacterMarketOrderHistoryResult = CharacterMarketOrderHistoryData & EsiReadResultMetadata

const characterMarketOrderHistoryRead = createCharacterEsiRead({
  operation: 'market-order-history',
  name: 'market-order-history-core',
  descriptor: operationRegistry.GetCharactersCharacterIdOrdersHistory.transport,
  encodeRequest: (input: CharacterMarketOrderHistoryRepresentationInput) => ({
    path: { character_id: input.characterId },
    query: { page: input.page },
  }),
  map: async (response, input): Promise<CharacterMarketOrderHistoryData> => {
    const personalOrders = response.data.filter((order) => !order.is_corporation)
    const [namesByType, namesByLocation] = await Promise.all([
      loadFinanceTypeNames(personalOrders.map((order) => order.type_id)),
      loadFinanceLocationNames(personalOrders.map((order) => order.location_id)),
    ])
    return {
      orders: personalOrders.map((order) =>
        Object.assign(mapMarketOrder(order, namesByType, namesByLocation), { state: order.state }),
      ),
      page: input.page,
      totalPages: resolveFinanceTotalPages(response.meta.pagination?.pages, input.page),
    }
  },
})

export async function getCharacterMarketOrders(
  characterId: number,
  subjectLifecycleId: string,
): Promise<CharacterMarketOrdersResult> {
  const result = await characterMarketOrdersRead.execute({ characterId, subjectLifecycleId })
  return { ...result.data, ...toEsiReadResultMetadata(result) }
}

export async function getCharacterMarketOrderHistory(
  characterId: number,
  page: number,
  subjectLifecycleId: string,
): Promise<CharacterMarketOrderHistoryResult> {
  assertFinancePositiveSafeInteger(page, 'Market order history page')
  const result = await characterMarketOrderHistoryRead.execute({
    characterId,
    page,
    subjectLifecycleId,
  })
  return { ...result.data, ...toEsiReadResultMetadata(result) }
}

function mapMarketOrder(
  order: EsiCharacterMarketOrder,
  namesByType: ReadonlyMap<number, string>,
  namesByLocation: ReadonlyMap<number, string>,
): CharacterMarketOrder {
  return {
    orderId: order.order_id,
    typeId: order.type_id,
    typeName: financeTypeName(order.type_id, namesByType),
    isBuy: order.is_buy_order ?? false,
    price: order.price,
    volumeRemain: order.volume_remain,
    volumeTotal: order.volume_total,
    minimumVolume: order.min_volume ?? null,
    escrow: order.escrow ?? null,
    range: order.range,
    locationId: order.location_id,
    locationName: financeLocationName(order.location_id, namesByLocation),
    regionId: order.region_id,
    issuedAt: order.issued,
    durationDays: order.duration,
    expiresAt: new Date(Date.parse(order.issued) + order.duration * 86_400_000).toISOString(),
  }
}
