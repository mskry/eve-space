import { isNonnegativeSafeInteger } from '../../type-guards.js'

export function parseFiniteNumber(value: string | null | undefined) {
  if (value === null || value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseNonnegativeFiniteNumber(value: string | null | undefined) {
  const parsed = parseFiniteNumber(value)
  return parsed !== undefined && parsed >= 0 ? parsed : undefined
}

/** Redis counter fields are absent until first written and must never surface as NaN. */
export function parseCount(value: string | null | undefined) {
  const parsed = parseFiniteNumber(value)
  return isNonnegativeSafeInteger(parsed) ? parsed : 0
}
