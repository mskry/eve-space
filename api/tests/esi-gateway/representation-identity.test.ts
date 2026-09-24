import { describe, expect, test } from 'vitest'
import { composeEnvelopeRepresentationVersion } from '../../src/esi-gateway/internal/envelope.js'
import { createEsiRepresentationIdentity } from '../../src/esi-gateway/internal/identity.js'
import { cacheEnvelopeKey, cacheIdentityVersion } from '../../src/esi-gateway/internal/keys.js'

const compatibilityDate = '2026-08-23'

describe('ESI representation-scoped identity', () => {
  test('two representation names of one operation produce two distinct identities', () => {
    const base = {
      compatibilityDate,
      inputs: { characterId: 1 },
      operation: 'skills' as const,
      representationVersion: 'v2',
    }
    const unnamed = createEsiRepresentationIdentity(base)
    const core = createEsiRepresentationIdentity({
      ...base,
      representationName: 'character-skills-core',
    })
    const alternate = createEsiRepresentationIdentity({
      ...base,
      representationName: 'character-skills-alternate',
    })

    expect(new Set([unnamed.digest, core.digest, alternate.digest])).toHaveLength(3)
    expect(
      new Set([unnamed.coordinationDigest, core.coordinationDigest, alternate.coordinationDigest]),
    ).toHaveLength(3)
  })

  test('the same representation name is stable across calls', () => {
    const base = {
      compatibilityDate,
      inputs: { characterId: 1 },
      operation: 'skills' as const,
      representationName: 'character-skills-core',
      representationVersion: 'v2',
    }
    expect(createEsiRepresentationIdentity(base)).toStrictEqual(
      createEsiRepresentationIdentity(base),
    )
  })

  test('carries the representation name into the envelope-stored representation version', () => {
    expect(composeEnvelopeRepresentationVersion('v2')).toBe('v2')
    expect(composeEnvelopeRepresentationVersion('v2', 'character-skills-core')).toBe(
      'character-skills-core@v2',
    )
    expect(composeEnvelopeRepresentationVersion('v2', 'character-skills-core')).not.toBe(
      composeEnvelopeRepresentationVersion('v2', 'character-skills-alternate'),
    )
  })

  test('the v3 cache identity prefix is in effect', () => {
    expect(cacheIdentityVersion).toBe('v3')
    const identity = createEsiRepresentationIdentity({
      compatibilityDate,
      inputs: { characterId: 1 },
      operation: 'skills',
      representationName: 'character-skills-core',
      representationVersion: 'v2',
    })
    expect(cacheEnvelopeKey('namespace-one', identity)).toContain(':v3:')
  })
})
