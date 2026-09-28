import { describe, expect, test } from 'vitest'
import {
  observationDeadline,
  observationDisplayStatus,
} from '../src/runtime/app/reviewer/observation-state.js'

const validatedAt = '2026-09-18T12:00:00Z'
const cachedUntil = '2026-09-18T12:00:05Z'
const current = { resourceId: 'current-ship', status: 'current' as const, validatedAt, cachedUntil }

describe('current-observation presentation policy', () => {
  test('leaves current precisely at original upstream expiry without sliding validation', () => {
    expect(observationDeadline(current)).toBe(Date.parse(cachedUntil))
    expect(observationDisplayStatus(current, Date.parse(cachedUntil) - 1)).toBe('current')
    expect(observationDisplayStatus(current, Date.parse(cachedUntil))).toBe('unavailable')
    expect(current.validatedAt).toBe(validatedAt)
  })

  test('applies the absolute 24-hour ceiling even when upstream expiry is later', () => {
    const longExpiry = { ...current, cachedUntil: '2026-09-20T12:00:00Z' }
    const ceiling = Date.parse(validatedAt) + 24 * 60 * 60 * 1000
    expect(observationDeadline(longExpiry)).toBe(ceiling)
    expect(observationDisplayStatus(longExpiry, ceiling)).toBe('unavailable')
  })

  test.each([
    ['stale', 'unavailable'],
    ['authorization-required', 'authorization-required'],
    ['never-collected', 'never-collected'],
    ['unavailable', 'unavailable'],
  ] as const)('does not release %s evidence as current', (status, expected) => {
    expect(observationDisplayStatus({ ...current, status }, Date.parse(validatedAt))).toBe(expected)
  })
})
