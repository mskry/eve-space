import type { EsiOperation } from './catalog-interface.js'
import {
  classifyEsiOperationFailure as classifyInternalEsiOperationFailure,
  classifyEsiRefreshFailure as classifyInternalEsiRefreshFailure,
  getEsiFailureStatus as getInternalEsiFailureStatus,
  isEsiAuthorizationFailure as isInternalEsiAuthorizationFailure,
  isEsiMutationOutcomeUnknown as isInternalEsiMutationOutcomeUnknown,
  type EsiFailure,
} from './internal/failure-policy.js'

export { EsiQuotaError } from './internal/quota-error.js'
export type { EsiFailure } from './internal/failure-policy.js'

export interface EsiQuotaRequest {
  readonly operation: EsiOperation
  readonly characterId?: number
}

export interface EsiQuotaStatus {
  readonly active: boolean
  readonly retryAfterSeconds: number | null
  readonly coordinationAvailable: boolean
}

export async function getEsiQuotaStatuses(
  requests: readonly EsiQuotaRequest[],
): Promise<readonly EsiQuotaStatus[]> {
  const [{ getProductionEsiExecutionRuntime }, { characterEsiPrincipal }] = await Promise.all([
    import('./internal/production-runtime.js'),
    import('./internal/identity.js'),
  ])
  return (await getProductionEsiExecutionRuntime()).getQuotaStatuses(
    requests.map(({ operation, characterId }) => ({
      operation,
      ...(characterId === undefined ? {} : { principal: characterEsiPrincipal(characterId) }),
    })),
  )
}

export async function isEsiOperationQuotaLimited(operation: EsiOperation) {
  const { getProductionEsiExecutionRuntime } = await import('./internal/production-runtime.js')
  return (await getProductionEsiExecutionRuntime()).isOperationQuotaLimited(operation)
}

export function classifyEsiOperationFailure(error: unknown): EsiFailure {
  return classifyInternalEsiOperationFailure(error)
}

export function classifyEsiRefreshFailure(error: unknown) {
  return classifyInternalEsiRefreshFailure(error)
}

export function getEsiFailureStatus(error: unknown) {
  return getInternalEsiFailureStatus(error)
}

export function isEsiAuthorizationFailure(error: unknown) {
  return isInternalEsiAuthorizationFailure(error)
}

export function isEsiMutationOutcomeUnknown(error: unknown) {
  return isInternalEsiMutationOutcomeUnknown(error)
}
