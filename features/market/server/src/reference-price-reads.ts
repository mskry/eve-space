import type { MarketReferenceReads } from './persistence.js'

export const validMarketReferenceTypes = (typeIds: readonly number[]) =>
  typeIds.length > 0 &&
  typeIds.length <= 100 &&
  typeIds.every((id) => Number.isSafeInteger(id) && id > 0) &&
  new Set(typeIds).size === typeIds.length

export const readMarketReferencePrices = async (
  persistence: MarketReferenceReads,
  typeIds: readonly number[],
) => {
  if (!validMarketReferenceTypes(typeIds)) throw new TypeError('Invalid market reference types')
  const rows = await persistence.readMarketReferencePrices({
    typeIds: typeIds.toSorted((left, right) => left - right),
  })
  return { kind: 'non-executable-reference' as const, rows }
}
