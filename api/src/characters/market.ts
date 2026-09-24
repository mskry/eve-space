import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetCharactersCharacterIdOrdersHistoryResponse,
  GetCharactersCharacterIdOrdersResponse,
} from '@evespace/esi-client/types'
import { z } from 'zod'
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

const characterMarketOrderCacheSchema = z.object({
  durationDays: z.number(),
  escrow: z.number().nullable(),
  expiresAt: z.string(),
  isBuy: z.boolean(),
  issuedAt: z.string(),
  locationId: z.number(),
  locationName: z.string().nullable(),
  minimumVolume: z.number().nullable(),
  orderId: z.number(),
  price: z.number(),
  range: z.enum([
    '1',
    '10',
    '2',
    '20',
    '3',
    '30',
    '4',
    '40',
    '5',
    'region',
    'solarsystem',
    'station',
  ]),
  regionId: z.number(),
  typeId: z.number(),
  typeName: z.string(),
  volumeRemain: z.number(),
  volumeTotal: z.number(),
})
const characterMarketOrdersCacheSchema = z.object({
  orders: z.array(characterMarketOrderCacheSchema),
})

const characterMarketOrdersRead = createCharacterEsiRead({
  cacheSchema: characterMarketOrdersCacheSchema,
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
  name: 'market-orders-core',
  operation: 'market-orders',
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

const characterMarketOrderHistoryCacheSchema = z.object({
  orders: z.array(
    characterMarketOrderCacheSchema.extend({ state: z.enum(['cancelled', 'expired']) }),
  ),
  page: z.number(),
  totalPages: z.number(),
})

const characterMarketOrderHistoryRead = createCharacterEsiRead({
  cacheSchema: characterMarketOrderHistoryCacheSchema,
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
  name: 'market-order-history-core',
  operation: 'market-order-history',
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
    durationDays: order.duration,
    escrow: order.escrow ?? null,
    expiresAt: new Date(Date.parse(order.issued) + order.duration * 86_400_000).toISOString(),
    isBuy: order.is_buy_order ?? false,
    issuedAt: order.issued,
    locationId: order.location_id,
    locationName: financeLocationName(order.location_id, namesByLocation),
    minimumVolume: order.min_volume ?? null,
    orderId: order.order_id,
    price: order.price,
    range: order.range,
    regionId: order.region_id,
    typeId: order.type_id,
    typeName: financeTypeName(order.type_id, namesByType),
    volumeRemain: order.volume_remain,
    volumeTotal: order.volume_total,
  }
}
