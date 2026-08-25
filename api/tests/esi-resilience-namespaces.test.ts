import { describe, expect, test } from 'vitest'
import {
  assertCacheValueSafe,
  cacheEnvelopeKey,
  cacheEnvelopeVersion,
  cacheIdentityVersion,
} from '../src/esi-resilience/namespaces.js'
import { createEsiRepresentationIdentity } from '../src/esi-resilience/identity.js'

describe('ESI cache namespaces', () => {
  test('versions cache envelope keys from public normalized identities', () => {
    const identity = createEsiRepresentationIdentity({
      operation: 'public-character',
      inputs: { characterId: 90_000_001 },
      compatibilityDate: '2026-08-23',
      representationVersion: 'v1',
    })
    expect(cacheEnvelopeKey('epoch-3', identity)).toBe(
      `eve-space:esi-cache:${cacheEnvelopeVersion}:${cacheIdentityVersion}:epoch-3:public-character:${identity.digest}`,
    )
  })

  test('hashes credential-like player values while rejecting credential fields in values', () => {
    const identity = createEsiRepresentationIdentity({
      operation: 'public-character',
      inputs: { characterId: 'Bearer Token Pilot' },
      compatibilityDate: '2026-08-23',
      representationVersion: 'v1',
    })
    expect(cacheEnvelopeKey('epoch-1', identity)).not.toContain('Bearer Token Pilot')
    expect(() => assertCacheValueSafe({ nested: { refreshToken: 'secret' } })).toThrow(
      'Unsafe cache value',
    )
  })
})
