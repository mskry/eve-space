import { operationRegistry } from '@evespace/esi-client/operations'
import { describe, expect, test, vi } from 'vitest'

describe('ESI representation registry', () => {
  test('registers a representation consistent with its operation contract and SDK descriptor', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { isRegisteredEsiRepresentation, registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = registerEsiRepresentation(
      skillsRepresentation(defineCharacterEsiRepresentation, 'skills-a'),
    )

    expect(isRegisteredEsiRepresentation(representation)).toBe(true)
  })

  test('registers a public representation against a public operation', async () => {
    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { isRegisteredEsiRepresentation, registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'status',
        name: 'status-public',
        descriptor: operationRegistry.GetStatus.transport,
        encodeRequest: () => ({}),
        map: ({ data }) => data,
      }),
    )

    expect(isRegisteredEsiRepresentation(representation)).toBe(true)
  })

  test('rejects a duplicate representation name', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    registerEsiRepresentation(skillsRepresentation(defineCharacterEsiRepresentation, 'skills-dup'))
    expect(() =>
      registerEsiRepresentation(
        skillsRepresentation(defineCharacterEsiRepresentation, 'skills-dup'),
      ),
    ).toThrow('representation skills-dup is already registered')
  })

  test('rejects a representation referencing an unknown ESI operation', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiRepresentation({
      operation: 'not-a-real-operation' as never,
      name: 'unknown-operation',
      descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
      encodeRequest: () => ({ path: { character_id: 1 } }),
      map: ({ data }) => data,
    })

    expect(() => registerEsiRepresentation(representation)).toThrow(
      'representation unknown-operation references unregistered ESI operation not-a-real-operation',
    )
  })

  test('rejects a character representation of a public operation', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiRepresentation({
      operation: 'status' as never,
      name: 'status-character',
      descriptor: operationRegistry.GetStatus.transport,
      encodeRequest: () => ({}),
      map: ({ data }) => data,
    })

    expect(() => registerEsiRepresentation(representation)).toThrow(
      'representation status-character declares character authorization but operation status requires public',
    )
  })

  test('rejects a descriptor that does not match the operation contract', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiRepresentation({
      operation: 'skills',
      name: 'skills-wrong-descriptor',
      descriptor: operationRegistry.GetCharactersCharacterIdAttributes.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data,
    })

    expect(() => registerEsiRepresentation(representation)).toThrow(
      'representation skills-wrong-descriptor binds SDK operation GetCharactersCharacterIdAttributes instead of GetCharactersCharacterIdSkills',
    )
  })

  test('rejects a structurally forged SDK descriptor with the expected operation ID', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiRepresentation({
      operation: 'skills',
      name: 'skills-forged-descriptor',
      descriptor: { ...operationRegistry.GetCharactersCharacterIdSkills.transport },
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data,
    })

    expect(() => registerEsiRepresentation(representation)).toThrow(
      'representation skills-forged-descriptor does not bind the registered SDK descriptor',
    )
  })

  test('registers a catalog-declared mutation representation', async () => {
    const { defineCharacterEsiMutation } =
      await import('../../src/esi-resilience/representations.js')
    const { isRegisteredEsiRepresentation, registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = registerEsiRepresentation(
      defineCharacterEsiMutation({
        operation: 'mail-send',
        name: 'mail-send-mutation',
        descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
        encodeRequest: (input: { characterId: number }) => ({
          path: { character_id: input.characterId },
          body: { approved_cost: 0, body: '', recipients: [], subject: '' },
        }),
        map: ({ data }) => data,
      }),
    )

    expect(isRegisteredEsiRepresentation(representation)).toBe(true)
  })

  test('rejects a read representation of a mutation operation', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiRepresentation({
      operation: 'mail-send' as never,
      name: 'mail-send-read',
      descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
        body: { approved_cost: 0, body: '', recipients: [], subject: '' },
      }),
      map: ({ data }) => data,
    })

    expect(() => registerEsiRepresentation(representation)).toThrow(
      'representation mail-send-read cannot read mutation operation mail-send',
    )
  })

  test('registers a read-like POST as a read representation', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { isRegisteredEsiRepresentation, registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = registerEsiRepresentation(
      defineCharacterEsiRepresentation({
        operation: 'character-cspa-charge',
        name: 'cspa-read',
        descriptor: operationRegistry.PostCharactersCharacterIdCspa.transport,
        encodeRequest: (input: { characterId: number }) => ({
          path: { character_id: input.characterId },
          body: [],
        }),
        map: ({ data }) => data,
      }),
    )

    expect(isRegisteredEsiRepresentation(representation)).toBe(true)
  })

  test('rejects a mutation representation of an undeclared operation', async () => {
    const { defineCharacterEsiMutation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiMutation({
      operation: 'skills' as never,
      name: 'skills-mutation',
      descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data,
    })

    expect(() => registerEsiRepresentation(representation)).toThrow(
      'representation skills-mutation cannot mutate undeclared operation skills',
    )
  })

  test('rejects a mutation representation of an unknown operation', async () => {
    const { defineCharacterEsiMutation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const representation = defineCharacterEsiMutation({
      operation: 'unknown-mutation' as never,
      name: 'unknown-mutation',
      descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
        body: { approved_cost: 0, body: '', recipients: [], subject: '' },
      }),
      map: ({ data }) => data,
    })

    expect(() => registerEsiRepresentation(representation)).toThrow(
      'representation unknown-mutation references unregistered ESI operation unknown-mutation',
    )
  })

  test('accepts separately named representations of one operation', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { isRegisteredEsiRepresentation, registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')

    const first = registerEsiRepresentation(
      skillsRepresentation(defineCharacterEsiRepresentation, 'skills-first'),
    )
    const second = registerEsiRepresentation(
      skillsRepresentation(defineCharacterEsiRepresentation, 'skills-second'),
    )

    expect(isRegisteredEsiRepresentation(first)).toBe(true)
    expect(isRegisteredEsiRepresentation(second)).toBe(true)
  })
})

describe('ESI representation registry module state', () => {
  test('resets cleanly between module reloads', async () => {
    const first = await import('../../src/esi-resilience/representation-registry.js')
    const firstRepresentations = await import('../../src/esi-resilience/representations.js')
    const representation = first.registerEsiRepresentation(
      skillsRepresentation(
        firstRepresentations.defineCharacterEsiRepresentation,
        'skills-isolated',
      ),
    )
    expect(first.isRegisteredEsiRepresentation(representation)).toBe(true)

    vi.resetModules()
    const second = await import('../../src/esi-resilience/representation-registry.js')

    expect(second.isRegisteredEsiRepresentation(representation)).toBe(false)
  })
})

type DefineRepresentation =
  (typeof import('../../src/esi-resilience/representations.js'))['defineCharacterEsiRepresentation']

function skillsRepresentation(defineRepresentation: DefineRepresentation, name: string) {
  return defineRepresentation({
    operation: 'skills',
    name,
    descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
    encodeRequest: (input: { characterId: number }) => ({
      path: { character_id: input.characterId },
    }),
    map: ({ data }) => data,
  })
}
