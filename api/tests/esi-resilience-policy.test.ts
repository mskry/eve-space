import { describe, expect, test } from 'vitest'
import {
  assertRegisteredEsiOperation,
  esiOperationPolicies,
  getEsiOperationPolicy,
} from '../src/esi-resilience/policy.js'

describe('ESI operation policies', () => {
  test('declares every backend ESI operation with quota behavior', () => {
    expect(Object.keys(esiOperationPolicies)).toEqual(
      expect.arrayContaining([
        'status',
        'public-character',
        'public-corporation',
        'public-alliance',
        'universe-races',
        'universe-bloodlines',
        'wallet-balance',
        'wallet-transactions',
        'skills',
        'location',
        'ship',
        'employment-history',
        'bulk-affiliation',
      ]),
    )
    expect(getEsiOperationPolicy('bulk-affiliation')).toMatchObject({
      valueCache: 'none',
      collapse: false,
      revalidate: false,
    })
    expect(getEsiOperationPolicy('public-character')).toMatchObject({
      valueCache: 'local',
      collapse: false,
    })
    expect(getEsiOperationPolicy('wallet-balance')).toMatchObject({
      valueCache: 'local',
      allowStale: false,
    })
  })

  test('fails closed for an unregistered operation name', () => {
    expect(() => assertRegisteredEsiOperation('new-unmetered-operation')).toThrow(
      'Unregistered ESI operation',
    )
  })
})
