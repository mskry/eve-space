import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCharacter: vi.fn(),
}))

vi.mock('../../src/esi-resilience/layer.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.getCharacter }),
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getCharacter.mockReset()
})

describe('ESI representation execute', () => {
  test('wires the layer resource from the representation and forwards its result', async () => {
    const cachedResult = {
      data: { totalSp: 1 },
      cachedUntil: '',
      validatedAt: '',
      source: 'esi' as const,
      stale: false,
      quota: {},
    }
    mocks.getCharacter.mockImplementation(
      async (resource: {
        load: (
          authority: { accessToken: string; principal: string },
          revalidation: object,
        ) => Promise<{ data: unknown }>
      }) => {
        const loaded = await resource.load(
          { accessToken: 'access-token', principal: 'character-1' },
          {},
        )
        expect(loaded.data).toEqual({ totalSp: 1 })
        return cachedResult
      },
    )

    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')

    const load = vi.fn(
      async (
        input: { characterId: number },
        authority: { accessToken: string; principal: string },
      ) => {
        expect(authority.principal).toBe('character-1')
        expect(authority.accessToken).toBe('access-token')
        return { data: { totalSp: input.characterId }, meta: { status: 200, headers: {} } }
      },
    )
    const encodeIdentity = vi.fn((input: { characterId: number }) => ({
      characterId: input.characterId,
    }))
    const representation = registerCharacterEsiRepresentation(
      defineCharacterEsiRepresentation<'skills', { characterId: number }, { totalSp: number }>({
        operation: 'skills',
        name: 'skills-execute-fixture',
        encodeIdentity,
        load,
      }),
    )

    await expect(execute(representation, { characterId: 1 })).resolves.toBe(cachedResult)

    expect(mocks.getCharacter).toHaveBeenCalledOnce()
    const resource = mocks.getCharacter.mock.calls[0]?.[0] as {
      operation: string
      inputs: Record<string, unknown>
    }
    expect(resource.operation).toBe('skills')
    expect(resource.inputs).toEqual({ characterId: 1 })
    expect(encodeIdentity).toHaveBeenCalledWith({ characterId: 1 })
    expect(load).toHaveBeenCalledOnce()
  })

  test('rejects a representation that was defined but never registered', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')

    const representation = defineCharacterEsiRepresentation<
      'skills',
      { characterId: number },
      unknown
    >({
      operation: 'skills',
      name: 'skills-unregistered',
      encodeIdentity: (input) => ({ characterId: input.characterId }),
      load: async () => ({ data: undefined, meta: { status: 200, headers: {} } }),
    })

    await expect(execute(representation, { characterId: 1 })).rejects.toThrow(
      'ESI representation skills-unregistered was not registered',
    )
    expect(mocks.getCharacter).not.toHaveBeenCalled()
  })
})
