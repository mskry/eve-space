import { describe, expect, it } from 'vitest'
import {
  formatSystemSecurityStatus,
  getSystemSecurityBand,
  getSystemSecurityClass,
  roundSystemSecurityStatus,
} from '../../app/utils/system-security'

describe('system security', () => {
  it.each([
    [-1.1, -1],
    [-0.06, -0.1],
    [-0.05, 0],
    [0, 0],
    [0.001, 0.1],
    [0.049, 0.1],
    [0.05, 0.1],
    [0.44, 0.4],
    [0.45, 0.5],
    [0.94, 0.9],
    [0.95, 1],
    [1.1, 1],
  ])('rounds %s to %s', (value, expected) => {
    expect(roundSystemSecurityStatus(value)).toBe(expected)
  })

  it('formats the rounded value with one decimal place', () => {
    expect(formatSystemSecurityStatus(0.049)).toBe('0.1')
    expect(formatSystemSecurityStatus(0)).toBe('0.0')
    expect(formatSystemSecurityStatus(-0.06)).toBe('-0.1')
  })

  it.each([
    [0.45, 'high-sec'],
    [0.449, 'low-sec'],
    [Number.MIN_VALUE, 'low-sec'],
    [0, 'null-sec'],
    [-0.1, 'null-sec'],
  ] as const)('classifies %s as %s', (value, expected) => {
    expect(getSystemSecurityClass(value)).toBe(expected)
  })

  it.each([
    [1, 10],
    [0.949, 9],
    [0.049, 1],
    [0, 0],
    [-0.1, 0],
  ])('maps %s to color band %s', (value, expected) => {
    expect(getSystemSecurityBand(value)).toBe(expected)
  })
})
