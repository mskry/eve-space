import { createMarketClient } from '@evespace/esi-client/domains/market'
import type {
  GetCharactersCharacterIdOrdersHistoryOutput,
  GetCharactersCharacterIdOrdersOutput,
} from '@evespace/esi-client/schemas'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { toEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'
import { financeLocationName, loadFinanceLocationNames } from './finance-location-names.js'
import { financeTypeName, loadFinanceTypeNames } from './finance-type-names.js'

export const marketOrdersScope = getCharacterEsiScope('market-orders')

type EsiCharacterMarketOrder =
  | GetCharactersCharacterIdOrdersOutput[number]
  | GetCharactersCharacterIdOrdersHistoryOutput[number]

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

interface CharacterMarketOrdersData {
  orders: CharacterMarketOrder[]
}

interface CharacterMarketOrderHistoryData {
  orders: Array<CharacterMarketOrder & { state: 'cancelled' | 'expired' }>
  page: number
  totalPages: number
}

export type CharacterMarketOrdersResult = CharacterMarketOrdersData & EsiResultMetadata
export type CharacterMarketOrderHistoryResult = CharacterMarketOrderHistoryData & EsiResultMetadata

export class MarketQuotaError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('ESI market quota is temporarily exhausted')
  }
}

export async function getCharacterMarketOrders(
  characterId: number,
): Promise<CharacterMarketOrdersResult> {
  try {
    const result = await getEsiResilienceLayer().getCharacter<CharacterMarketOrdersData>({
      operation: 'market-orders',
      inputs: { characterId },
      load: async (authority, revalidation) => {
        const response = await createMarketClient({
          fetch: createEsiTransport('market-orders', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .listCharacterOrders(characterId, revalidation)
        const personalOrders = response.data.filter((order) => !order.is_corporation)
        const [namesByType, namesByLocation] = await Promise.all([
          loadFinanceTypeNames(personalOrders.map((order) => order.type_id)),
          loadFinanceLocationNames(personalOrders.map((order) => order.location_id)),
        ])
        return {
          data: {
            orders: personalOrders.map((order) =>
              mapMarketOrder(order, namesByType, namesByLocation),
            ),
          },
          meta: response.meta,
        }
      },
    })
    return { ...result.data, ...toEsiResultMetadata(result) }
  } catch (error) {
    throwMarketError(error)
  }
}

export async function getCharacterMarketOrderHistory(
  characterId: number,
  page: number,
): Promise<CharacterMarketOrderHistoryResult> {
  assertPositiveSafeInteger(page, 'Market order history page')
  try {
    const result = await getEsiResilienceLayer().getCharacter<CharacterMarketOrderHistoryData>({
      operation: 'market-order-history',
      inputs: { characterId, page },
      load: async (authority, revalidation) => {
        const response = await createMarketClient({
          fetch: createEsiTransport('market-order-history', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .listCharacterOrderHistory(characterId, { page, ...revalidation })
        const personalOrders = response.data.filter((order) => !order.is_corporation)
        const [namesByType, namesByLocation] = await Promise.all([
          loadFinanceTypeNames(personalOrders.map((order) => order.type_id)),
          loadFinanceLocationNames(personalOrders.map((order) => order.location_id)),
        ])
        return {
          data: {
            orders: personalOrders.map((order) =>
              Object.assign(mapMarketOrder(order, namesByType, namesByLocation), {
                state: order.state,
              }),
            ),
            page,
            totalPages: paginationPages(response.meta.pagination?.pages, page),
          },
          meta: response.meta,
        }
      },
    })
    return { ...result.data, ...toEsiResultMetadata(result) }
  } catch (error) {
    throwMarketError(error)
  }
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

function paginationPages(value: number | undefined, page: number) {
  if (value === undefined || value === 0) return page
  assertPositiveSafeInteger(value, 'ESI pagination total')
  return value
}

function assertPositiveSafeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new Error(`${name} must be a positive safe integer`)
}

function throwMarketError(error: unknown): never {
  if (error instanceof EsiQuotaError) throw new MarketQuotaError(error.retryAfterSeconds)
  throw error
}
