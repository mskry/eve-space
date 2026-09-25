import { isPositiveSafeInteger } from '../type-guards.js'

export function assertFinancePositiveSafeInteger(
  value: unknown,
  name: string,
): asserts value is number {
  if (!isPositiveSafeInteger(value)) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}

export function resolveFinanceTotalPages(totalPages: number | undefined, requestedPage: number) {
  if (totalPages === undefined || totalPages === 0) {
    return requestedPage
  }
  if (!isPositiveSafeInteger(totalPages)) {
    throw new Error('ESI pagination total must be a positive safe integer')
  }
  return totalPages
}
