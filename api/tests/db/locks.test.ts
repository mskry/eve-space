import { describe, expect, test } from 'vitest'
import {
  assertDistinctModuleMigrationLockKeys,
  characterLockKey,
  characterLockNamespace,
  moduleMigrationLockKey,
  moduleMigrationLockNamespace,
} from '../../src/db/locks.js'

const int32Min = -(2 ** 31)
const int32Max = 2 ** 31 - 1

describe('character advisory lock key', () => {
  test('leaves every ID EVE allocates today mapping to itself', () => {
    // Unchanged identity means a rolling deploy cannot split one character across two keys.
    for (const characterId of [90_000_000, 95_465_499, 2_100_000_000, int32Max])
      expect(characterLockKey(characterId)).toBe(characterId)
  })

  test('keeps IDs past the integer boundary inside the signed 32-bit slot', () => {
    // These are the IDs that previously raised SQLSTATE 22003 instead of taking a lock.
    for (const characterId of [2_147_483_648, 4_294_967_295, 2 ** 48, Number.MAX_SAFE_INTEGER]) {
      const key = characterLockKey(characterId)
      expect(Number.isInteger(key)).toBe(true)
      expect(key).toBeGreaterThanOrEqual(int32Min)
      expect(key).toBeLessThanOrEqual(int32Max)
    }
  })

  test('never collides below 2^32', () => {
    const samples = [
      0,
      1,
      2,
      90_000_000,
      int32Max,
      2_147_483_648,
      2_147_483_649,
      3_000_000_000,
      4_294_967_295,
    ]
    expect(new Set(samples.map(characterLockKey)).size).toBe(samples.length)
  })
})

describe('module migration advisory lock key', () => {
  test('uses a separate namespaced lock range with stable keys', () => {
    expect(moduleMigrationLockNamespace).not.toBe(characterLockNamespace)
    expect([
      moduleMigrationLockKey('alpha'),
      moduleMigrationLockKey('beta'),
      moduleMigrationLockKey('member-audit'),
    ]).toEqual([-335_810_923, 1_367_506_850, 1_771_844_603])
  })

  test('rejects collisions while allowing repeated migrations for one module', () => {
    expect(() => assertDistinctModuleMigrationLockKeys(['alpha', 'alpha', 'beta'])).not.toThrow()
    expect(() => assertDistinctModuleMigrationLockKeys(['alpha', 'beta'], () => 42)).toThrow(
      'key 42 collides between alpha and beta',
    )
  })
})
