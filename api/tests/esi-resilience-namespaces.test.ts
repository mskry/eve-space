import { describe, expect, test } from 'vitest'
import {
  assertCacheValueSafe,
  cacheEnvelopeKey,
  cacheEnvelopeVersion,
} from '../src/esi-resilience/namespaces.js'

describe('ESI cache namespaces', () => {
  test('versions cache envelope keys from public normalized identities', () => {
    expect(cacheEnvelopeKey(3, 'public-character', 'character-90000001')).toBe(
      `eve-space:esi-cache:${cacheEnvelopeVersion}:3:public-character:character-90000001`,
    )
  })

  test('rejects credential-like cache identities and values', () => {
    expect(() => cacheEnvelopeKey(1, 'wallet-token', 'character-90000001')).toThrow(
      'Unsafe cache operation identity',
    )
    expect(() => assertCacheValueSafe({ nested: { refreshToken: 'secret' } })).toThrow(
      'Unsafe cache value',
    )
  })
})
