import {
  globalPlexMarketRegionId,
  marketCollectionBounds,
  plexMarketTypeId,
  supportedPublicMarketRegions,
} from './market-bounds.js'
import { formatCents, type MarketOrderRow } from './order-depth.js'

export interface PublicMarketWireOrder {
  readonly order_id: number
  readonly type_id: number
  readonly location_id: number
  readonly system_id: number
  readonly is_buy_order: boolean
  readonly price: number
  readonly volume_remain: number
  readonly issued: string
  readonly duration: number
  readonly min_volume: number
  readonly range: string
}

export type StructureMarketWireOrder = Omit<PublicMarketWireOrder, 'system_id'>

export interface MarketWireReferencePrice {
  readonly type_id: number
  readonly adjusted_price?: number
  readonly average_price?: number
}

export interface MarketReferencePrice {
  readonly typeId: number
  readonly adjustedPriceIsk: string | null
  readonly averagePriceIsk: string | null
}

export interface MarketDailyWireRecord {
  readonly date: string
  readonly average: number
  readonly highest: number
  readonly lowest: number
  readonly volume: number
  readonly order_count: number
}

export interface MarketDailyRecord {
  readonly date: string
  readonly averageIsk: string
  readonly highIsk: string
  readonly lowIsk: string
  readonly volume: number
  readonly orderCount: number
}

const positiveId = (id: number, label: string) => {
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError(`Invalid ${label}`)
  return id
}

const publicRegion = (regionId: number) => {
  if (!supportedPublicMarketRegions.some((supported) => supported === regionId)) {
    throw new TypeError('Unsupported public Market region')
  }
  return regionId
}

const boundedPage = (page: number) => {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > marketCollectionBounds.maximumPagesPerObservation
  ) {
    throw new RangeError('Market page exceeds the collection bound')
  }
  return page
}

const exactIsk = (value: number) => {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))) {
    throw new TypeError('Market price is outside the exact ISK range')
  }
  const cents = Math.round(value * 100)
  if (Math.abs(value * 100 - cents) > 0.00001) {
    throw new TypeError('Market price has more than two decimal places')
  }
  return formatCents(BigInt(cents))
}

export const regionOrderRequest = (regionId: number, page: number, typeId?: number) => {
  publicRegion(regionId)
  boundedPage(page)
  if (typeId !== undefined) positiveId(typeId, 'Market type ID')
  if (regionId === globalPlexMarketRegionId && typeId !== plexMarketTypeId) {
    throw new TypeError('Global PLEX Market accepts only PLEX orders')
  }
  return { regionId, page, orderType: 'all' as const, ...(typeId && { typeId }) }
}

export const regionTypesRequest = (regionId: number, page: number) => {
  publicRegion(regionId)
  boundedPage(page)
  return { regionId, page }
}

export const regionHistoryRequest = (regionId: number, typeId: number) => {
  publicRegion(regionId)
  positiveId(typeId, 'Market type ID')
  if (regionId === globalPlexMarketRegionId && typeId !== plexMarketTypeId) {
    throw new TypeError('Global PLEX Market accepts only PLEX history')
  }
  return { regionId, typeId }
}

export const structureOrdersRequest = (structureId: number, page: number) => {
  positiveId(structureId, 'Market structure ID')
  boundedPage(page)
  return { structureId, page }
}

export const referencePricesRequest = () => ({})

export const mapActiveMarketTypes = (typeIds: readonly number[]) => {
  if (typeIds.length > 1000) throw new RangeError('Active Market type page exceeds its bound')
  return [...new Set(typeIds.map((id) => positiveId(id, 'Active Market type ID')))].toSorted(
    (left, right) => left - right,
  )
}

const mapMarketOrder = (
  order: PublicMarketWireOrder | StructureMarketWireOrder,
): MarketOrderRow => {
  if (!Number.isSafeInteger(order.volume_remain) || order.volume_remain < 0) {
    throw new TypeError('Invalid remaining Market volume')
  }
  if (
    !Number.isSafeInteger(order.duration) ||
    order.duration < 0 ||
    order.duration > marketCollectionBounds.maximumOrderDurationDays
  ) {
    throw new TypeError('Invalid Market duration')
  }
  const issuedAt = new Date(order.issued)
  if (Number.isNaN(issuedAt.getTime())) throw new TypeError('Invalid Market issue time')
  return {
    orderId: positiveId(order.order_id, 'Market order ID'),
    typeId: positiveId(order.type_id, 'Market type ID'),
    locationId: positiveId(order.location_id, 'Market location ID'),
    solarSystemId:
      'system_id' in order ? positiveId(order.system_id, 'Market solar-system ID') : null,
    side: order.is_buy_order ? 'buy' : 'sell',
    price: exactIsk(order.price),
    volumeRemain: order.volume_remain,
    issuedAt: issuedAt.toISOString(),
    durationDays: order.duration,
    minimumVolume: positiveId(order.min_volume, 'Market minimum volume'),
    range: order.range,
  }
}

export const mapPublicMarketOrder = (order: PublicMarketWireOrder): MarketOrderRow =>
  mapMarketOrder(order)

export const mapStructureMarketOrder = (order: StructureMarketWireOrder): MarketOrderRow =>
  mapMarketOrder(order)

export const mapReferencePrice = (price: MarketWireReferencePrice): MarketReferencePrice => ({
  typeId: positiveId(price.type_id, 'Market reference type ID'),
  adjustedPriceIsk: price.adjusted_price === undefined ? null : exactIsk(price.adjusted_price),
  averagePriceIsk: price.average_price === undefined ? null : exactIsk(price.average_price),
})

export const mapMarketDailyRecord = (record: MarketDailyWireRecord): MarketDailyRecord => {
  const day = new Date(record.date)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
    Number.isNaN(day.getTime()) ||
    day.toISOString().slice(0, 10) !== record.date
  ) {
    throw new TypeError('Invalid Market history date')
  }
  if (
    ![record.volume, record.order_count].every((value) => Number.isSafeInteger(value) && value >= 0)
  ) {
    throw new TypeError('Invalid Market history quantity')
  }
  const averageIsk = exactIsk(record.average)
  const highIsk = exactIsk(record.highest)
  const lowIsk = exactIsk(record.lowest)
  if (record.lowest > record.average || record.average > record.highest) {
    throw new TypeError('Market history prices are incoherent')
  }
  return {
    date: record.date,
    averageIsk,
    highIsk,
    lowIsk,
    volume: record.volume,
    orderCount: record.order_count,
  }
}
