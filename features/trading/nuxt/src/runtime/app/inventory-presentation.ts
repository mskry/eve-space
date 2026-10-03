import { ApiQueryError } from '@eve-space/platform-module-nuxt/runtime'
import type { TradingInventoryStatusFragment } from './trading-graphql'

export const coverageLabel = (state: string) =>
  ({
    'included-current': 'Current complete observation',
    'included-stale': 'Readable stale observation',
    'authorization-required': 'Assets authorization required',
    'never-collected': 'No observation collected',
    unavailable: 'Source unavailable; holdings unknown',
    incomplete: 'Incomplete source; holdings unknown',
    'beyond-retention': 'Source no longer readable',
    'conflicting-source': 'Conflicting item observations; disputed items excluded',
  })[state] ?? 'Source unavailable; holdings unknown'

export const inventoryMessage = (error?: Error) => {
  const code = error instanceof ApiQueryError ? error.code : undefined
  if (code === 'INVENTORY_LIMIT' || code === 'OPERATION_LIMIT')
    return 'The complete inventory exceeds supported limits. Narrow your personal character selection and retry; no partial totals are shown.'
  if (code?.startsWith('INVENTORY_') && code !== 'INVENTORY_SCOPE_DENIED')
    return 'The inventory source or authority changed. Restart to read one consistent view.'
  if (code === 'BAD_USER_INPUT') return 'Check the filters and selected scope, then retry.'
  if (code === 'MODULE_DISABLED')
    return 'Inventory is disabled. Contact your deployment administrator.'
  if (code === 'AUTH_REQUIRED') return 'Sign in again to view inventory.'
  return 'Inventory is unavailable. Verify access and retry.'
}

export const assertSameInventoryView = (
  left: TradingInventoryStatusFragment,
  right: TradingInventoryStatusFragment,
) => {
  if (left.fingerprint !== right.fingerprint)
    throw new ApiQueryError('Inventory observations changed.', {
      code: 'INVENTORY_SOURCE_CHANGED',
      status: 409,
    })
}
