import { operationRegistry } from '@evespace/esi-client/operations'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  createClient: vi.fn(),
  createTransport: vi.fn(),
  executeCharacterMutationRepresentation: vi.fn(),
  executeCharacterRepresentation: vi.fn(),
  executePublicRepresentation: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@evespace/esi-client')>()
  return {
    ...original,
    EsiClient: class {
      constructor(options: unknown) {
        mocks.createClient(options)
      }

      callOperation(...arguments_: unknown[]) {
        return mocks.callOperation(...arguments_)
      }
    },
  }
})

vi.mock('../../src/esi-resilience/request-transport.js', () => ({
  createEsiTransport: mocks.createTransport,
}))

vi.mock('../../src/esi-resilience/layer.js', () => ({
  getEsiResilienceLayer: () => ({
    executeCharacterMutationRepresentation: mocks.executeCharacterMutationRepresentation,
    executeCharacterRepresentation: mocks.executeCharacterRepresentation,
    executePublicRepresentation: mocks.executePublicRepresentation,
  }),
}))

beforeEach(() => {
  mocks.callOperation.mockReset()
  mocks.createClient.mockReset()
  mocks.createTransport.mockReset()
  mocks.executeCharacterMutationRepresentation.mockReset()
  mocks.executeCharacterRepresentation.mockReset()
  mocks.executePublicRepresentation.mockReset()
  mocks.createTransport.mockReturnValue(vi.fn())
})

describe('ESI representation execute', () => {
  test('owns SDK dispatch, transport, revalidation, mapping, and representation identity', async () => {
    const response = {
      data: { total_sp: 1, skills: [] },
      meta: { status: 200, headers: {} },
    }
    const cachedResult = {
      data: { totalSp: 1 },
      cachedUntil: '',
      validatedAt: '',
      source: 'esi' as const,
      stale: false,
      quota: {},
    }
    mocks.callOperation.mockResolvedValue(response)
    mocks.executeCharacterRepresentation.mockImplementation(
      async (
        _representation: unknown,
        resource: {
          load: (
            authority: { accessToken: string; principal: string },
            revalidation: object,
          ) => Promise<{ data: unknown }>
        },
      ) => {
        const loaded = await resource.load(
          { accessToken: 'access-token', principal: 'character-1' },
          { ifNoneMatch: '"etag"' },
        )
        expect(loaded.data).toEqual({ totalSp: 1 })
        return cachedResult
      },
    )

    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const encodeRequest = vi.fn((input: { characterId: number }) => ({
      path: { character_id: input.characterId },
    }))
    const map = vi.fn(({ data }: { data: { total_sp: number; skills: readonly unknown[] } }) => ({
      totalSp: data.total_sp,
    }))
    const representation = registerEsiRepresentation(
      defineCharacterEsiRepresentation({
        operation: 'skills',
        name: 'skills-execute-fixture',
        descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
        encodeRequest,
        map,
      }),
    )

    await expect(execute(representation, { characterId: 1 })).resolves.toBe(cachedResult)

    expect(mocks.executeCharacterRepresentation).toHaveBeenCalledOnce()
    expect(mocks.executeCharacterRepresentation.mock.calls[0]?.[0]).toBe(representation)
    expect(mocks.executeCharacterRepresentation.mock.calls[0]?.[1]).toMatchObject({
      operation: 'skills',
      characterId: 1,
      inputs: { path: { character_id: 1 } },
    })
    expect(mocks.createTransport).toHaveBeenCalledWith('skills', 'character-1')
    expect(mocks.createClient).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      token: 'access-token',
      validateResponses: true,
    })
    expect(mocks.callOperation).toHaveBeenCalledWith('GetCharactersCharacterIdSkills', {
      path: { character_id: 1 },
      headers: { 'If-None-Match': '"etag"' },
    })
    expect(encodeRequest).toHaveBeenCalledWith({ characterId: 1 })
    expect(map).toHaveBeenCalledWith(response, { characterId: 1 })
  })

  test('executes public representations without resolving character authorization', async () => {
    const response = {
      data: [{ category: 'character', id: 1, name: 'Pilot' }],
      meta: { status: 200, headers: {} },
    }
    const cachedResult = {
      data: response.data,
      cachedUntil: '',
      validatedAt: '',
      source: 'esi' as const,
      stale: false,
      quota: {},
    }
    mocks.callOperation.mockResolvedValue(response)
    mocks.executePublicRepresentation.mockImplementation(async (_representation, resource) => {
      const loaded = await resource.load({ ifModifiedSince: 'date' })
      expect(loaded.data).toEqual(response.data)
      return cachedResult
    })

    const { definePublicEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const representation = registerEsiRepresentation(
      definePublicEsiRepresentation({
        operation: 'universe-resolve-names',
        name: 'universe-names-execute-fixture',
        descriptor: operationRegistry.PostUniverseNames.transport,
        encodeRequest: (input: { body: number[] }) => input,
        map: ({ data }) => data,
      }),
    )

    await expect(execute(representation, { body: [1] })).resolves.toBe(cachedResult)
    expect(mocks.executePublicRepresentation).toHaveBeenCalledWith(
      representation,
      expect.objectContaining({
        operation: 'universe-resolve-names',
        inputs: { body: [1] },
      }),
    )
    expect(mocks.createTransport).toHaveBeenCalledWith('universe-resolve-names', undefined)
    expect(mocks.createClient).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      validateResponses: true,
    })
    expect(mocks.callOperation).toHaveBeenCalledWith('PostUniverseNames', {
      body: [1],
      headers: { 'If-Modified-Since': 'date' },
    })
    expect(mocks.executeCharacterRepresentation).not.toHaveBeenCalled()
  })

  test('executes only a catalog-approved mutation with both SDK gates and maps before revision', async () => {
    const sequence: string[] = []
    const response = {
      data: 7001,
      meta: { status: 201, headers: {} },
    }
    mocks.callOperation.mockResolvedValue(response)
    mocks.executeCharacterMutationRepresentation.mockImplementation(
      async (
        _representation: unknown,
        mutation: {
          load: (authority: {
            accessToken: string
            principal: string
          }) => Promise<{ data: unknown }>
        },
      ) => {
        const loaded = await mutation.load({
          accessToken: 'access-token',
          principal: 'character-1',
        })
        sequence.push('revision')
        return loaded
      },
    )

    const { defineCharacterEsiMutation } =
      await import('../../src/esi-resilience/representations.js')
    const { registerEsiRepresentation } =
      await import('../../src/esi-resilience/representation-registry.js')
    const { executeMutation } = await import('../../src/esi-resilience/execute.js')
    const representation = registerEsiRepresentation(
      defineCharacterEsiMutation({
        operation: 'mail-send',
        name: 'mail-send-execute-fixture',
        descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
        encodeRequest: (input: { characterId: number; subject: string }) => ({
          path: { character_id: input.characterId },
          body: { approved_cost: 0, body: '', recipients: [], subject: input.subject },
        }),
        map: async ({ data }, input) => {
          await Promise.resolve()
          sequence.push('map')
          return { characterId: input.characterId, mailId: data }
        },
      }),
    )

    await expect(
      executeMutation(representation, { characterId: 1, subject: 'Subject' }),
    ).resolves.toEqual({ characterId: 1, mailId: 7001 })

    expect(sequence).toEqual(['map', 'revision'])
    expect(mocks.createClient).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      token: 'access-token',
      validateResponses: true,
      allowGenericMutations: true,
    })
    expect(mocks.callOperation).toHaveBeenCalledWith(
      'PostCharactersCharacterIdMail',
      {
        path: { character_id: 1 },
        body: { approved_cost: 0, body: '', recipients: [], subject: 'Subject' },
      },
      { confirmMutation: true },
    )
  })

  test('rejects an unregistered mutation before transport or SDK client construction', async () => {
    const { defineCharacterEsiMutation } =
      await import('../../src/esi-resilience/representations.js')
    const { executeMutation } = await import('../../src/esi-resilience/execute.js')
    const representation = defineCharacterEsiMutation({
      operation: 'mail-send',
      name: 'mail-send-unregistered',
      descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
        body: { approved_cost: 0, body: '', recipients: [], subject: '' },
      }),
      map: ({ data }) => data,
    })

    await expect(executeMutation(representation, { characterId: 1 })).rejects.toThrow(
      'ESI representation mail-send-unregistered was not registered',
    )
    expect(mocks.createTransport).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.callOperation).not.toHaveBeenCalled()
  })

  test.each(['IF-NONE-MATCH', 'if-modified-since'])(
    'rejects executor-owned %s from a representation encoder',
    async (headerName) => {
      mocks.executeCharacterRepresentation.mockImplementation(
        (resource: {
          load: (
            authority: { accessToken: string; principal: string },
            revalidation: object,
          ) => Promise<unknown>
        }) => resource.load({ accessToken: 'token', principal: 'character-1' }, {}),
      )

      const { defineCharacterEsiRepresentation } =
        await import('../../src/esi-resilience/representations.js')
      const { registerEsiRepresentation } =
        await import('../../src/esi-resilience/representation-registry.js')
      const { execute } = await import('../../src/esi-resilience/execute.js')
      const representation = registerEsiRepresentation(
        defineCharacterEsiRepresentation({
          operation: 'skills',
          name: `skills-reserved-${headerName.toLowerCase()}`,
          descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
          encodeRequest: (input: { characterId: number }) =>
            ({
              path: { character_id: input.characterId },
              headers: { [headerName]: 'caller-value' },
            }) as never,
          map: ({ data }) => data,
        }),
      )

      await expect(execute(representation, { characterId: 1 })).rejects.toThrow(
        `ESI request header ${headerName} is executor-owned`,
      )
      expect(mocks.callOperation).not.toHaveBeenCalled()
      expect(mocks.executeCharacterRepresentation).not.toHaveBeenCalled()
    },
  )

  test('rejects a representation that was defined but never registered', async () => {
    const { defineCharacterEsiRepresentation } =
      await import('../../src/esi-resilience/representations.js')
    const { execute } = await import('../../src/esi-resilience/execute.js')
    const representation = defineCharacterEsiRepresentation({
      operation: 'skills',
      name: 'skills-unregistered',
      descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
      encodeRequest: (input: { characterId: number }) => ({
        path: { character_id: input.characterId },
      }),
      map: ({ data }) => data,
    })

    await expect(execute(representation, { characterId: 1 })).rejects.toThrow(
      'ESI representation skills-unregistered was not registered',
    )
    expect(mocks.executeCharacterRepresentation).not.toHaveBeenCalled()
  })
})
