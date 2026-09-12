import { closeOwnedProductionEsiExecutionRuntime } from './internal/production-runtime.js'

export function closeProductionEsiExecutionRuntime() {
  return closeOwnedProductionEsiExecutionRuntime()
}
