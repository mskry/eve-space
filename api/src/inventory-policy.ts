import { createHash } from 'node:crypto'
import type { ReadAdmissionDenial } from './auth/read-policy.js'
import type {
  PlatformInventoryGroup,
  PlatformInventoryFilters,
} from '@eve-space/platform-module-contract/inventory'

export const inventoryAssetsScope = 'esi-assets.read_assets.v1'

export const inventoryGroupMatchesFilters = (
  group: PlatformInventoryGroup,
  filters: PlatformInventoryFilters = {},
) =>
  (filters.typeId === undefined || group.typeId === filters.typeId) &&
  (filters.groupId === undefined || group.groupId === filters.groupId) &&
  (filters.categoryId === undefined || group.categoryId === filters.categoryId) &&
  (filters.locationKey === undefined || group.location.key === filters.locationKey)

export const inventoryDenial = (
  code: 'INVENTORY_SCOPE_DENIED' | 'INVENTORY_LIMIT' | 'INVENTORY_AUTHORIZATION_CHANGED',
): ReadAdmissionDenial => ({
  admitted: false,
  status: code === 'INVENTORY_AUTHORIZATION_CHANGED' ? 409 : 403,
  body: {
    code,
    message: {
      INVENTORY_SCOPE_DENIED: 'Inventory scope is unavailable.',
      INVENTORY_LIMIT: 'Inventory scope exceeds supported bounds. Narrow the selection.',
      INVENTORY_AUTHORIZATION_CHANGED: 'Inventory authorization changed. Restart this read.',
    }[code],
  },
})

export const inventoryFingerprint = <Binding>(binding: Binding): string =>
  createHash('sha256').update(JSON.stringify(binding)).digest('hex')

export const normalizeInventorySelection = (
  ids: readonly number[] | undefined,
  maximum: number,
): readonly number[] | undefined => {
  if (ids === undefined) return undefined
  if (ids.length > maximum || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new TypeError('Invalid bounded inventory selection')
  }
  return Object.freeze([...new Set(ids)].toSorted((left, right) => left - right))
}
