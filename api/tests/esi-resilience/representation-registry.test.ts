import { beforeEach, describe, expect, test, vi } from 'vitest'

const loadResult = { data: undefined, meta: { status: 200, headers: {} } }

beforeEach(() => {
  vi.resetModules()
})

describe('ESI representation registry', () => {
  test('registers a representation consistent with its operation contract', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const {
      getSoleRegisteredEsiRepresentationName,
      isRegisteredEsiRepresentation,
      registerCharacterEsiRepresentation,
    } = await import('../../src/esi-resilience/representation-registry.js')

    const representation = registerCharacterEsiRepresentation(
      defineCharacterEsiRepresentation<'skills', { characterId: number }, unknown>({
        operation: 'skills',
        name: 'skills-a',
        encodeIdentity: (input) => ({ characterId: input.characterId }),
        load: async () => loadResult,
      }),
    )

    expect(isRegisteredEsiRepresentation(representation)).toBe(true)
    expect(getSoleRegisteredEsiRepresentationName('skills')).toBe('skills-a')
  })

  test('rejects a duplicate representation name', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const representation = () =>
      defineCharacterEsiRepresentation<'skills', { characterId: number }, unknown>({
        operation: 'skills',
        name: 'skills-dup',
        encodeIdentity: (input) => ({ characterId: input.characterId }),
        load: async () => loadResult,
      })

    registerCharacterEsiRepresentation(representation())
    expect(() => registerCharacterEsiRepresentation(representation())).toThrow(
      'representation skills-dup is already registered',
    )
  })

  test('rejects a representation referencing an unknown ESI operation', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiRepresentation({
      operation: 'not-a-real-operation' as never,
      name: 'unknown-operation',
      encodeIdentity: () => ({}),
      load: async () => loadResult,
    })

    expect(() => registerCharacterEsiRepresentation(representation)).toThrow(
      'representation unknown-operation references unregistered ESI operation not-a-real-operation',
    )
  })

  test('rejects a character representation of a public operation', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiRepresentation({
      operation: 'status' as never,
      name: 'status-character',
      encodeIdentity: () => ({}),
      load: async () => loadResult,
    })

    expect(() => registerCharacterEsiRepresentation(representation)).toThrow(
      'representation status-character declares character authorization but operation status requires public',
    )
  })

  test('rejects a core representation of a mutation operation', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiRepresentation({
      operation: 'character-cspa-charge' as never,
      name: 'cspa-core',
      encodeIdentity: (input: { characterId: number }) => ({ characterId: input.characterId }),
      load: async () => loadResult,
    })

    expect(() => registerCharacterEsiRepresentation(representation)).toThrow(
      'representation cspa-core cannot be a core representation of mutation operation character-cspa-charge',
    )
  })

  test('accepts a second representation of one operation, but the shared-layer lookup cannot disambiguate it', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { getSoleRegisteredEsiRepresentationName, registerCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const fixture = (name: string) =>
      defineCharacterEsiRepresentation<'skills', { characterId: number }, unknown>({
        operation: 'skills',
        name,
        encodeIdentity: (input) => ({ characterId: input.characterId }),
        load: async () => loadResult,
      })

    expect(() => registerCharacterEsiRepresentation(fixture('skills-first'))).not.toThrow()
    expect(() => registerCharacterEsiRepresentation(fixture('skills-second'))).not.toThrow()
    expect(() => getSoleRegisteredEsiRepresentationName('skills')).toThrow(
      'ESI operation skills has multiple registered representations',
    )
  })

  test('returns undefined for an operation with no registered representation', async () => {
    const { getSoleRegisteredEsiRepresentationName } =
      await import('../../src/esi-resilience/representation-registry.js')
    expect(getSoleRegisteredEsiRepresentationName('character-clones')).toBeUndefined()
  })
})

describe('ESI representation registry module state', () => {
  test('resets cleanly between module reloads', async () => {
    const first = await import('../../src/esi-resilience/representation-registry.js')
    const firstRepresentations = await import('../../src/esi-resilience/representations.js')
    first.registerCharacterEsiRepresentation(
      firstRepresentations.defineCharacterEsiRepresentation<
        'skills',
        { characterId: number },
        unknown
      >({
        operation: 'skills',
        name: 'skills-isolated',
        encodeIdentity: (input) => ({ characterId: input.characterId }),
        load: async () => loadResult,
      }),
    )
    expect(first.getSoleRegisteredEsiRepresentationName('skills')).toBe('skills-isolated')

    vi.resetModules()
    const second = await import('../../src/esi-resilience/representation-registry.js')

    expect(second.getSoleRegisteredEsiRepresentationName('skills')).toBeUndefined()
  })
})
