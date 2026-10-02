import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createDeferred } from './support/deferred.js'
import { graphql } from 'graphql'
import { createSchema } from 'graphql-yoga'
import { createFeatureExecutionMock } from './support/mock-feature-execution.js'

const mocks = vi.hoisted(() => {
  const types = { from: vi.fn(), leftJoin: vi.fn(), where: vi.fn(), limit: vi.fn() }
  return {
    owned: vi.fn(),
    authorization: vi.fn(),
    page: vi.fn(),
    execute: vi.fn(),
    types,
    locations: vi.fn(),
    names: vi.fn(),
  }
})
vi.mock('../src/auth/character-lifecycle.js', () => ({
  findOwnedCharacter: mocks.owned,
  pageUserCharacterIdentities: mocks.page,
}))
vi.mock('../src/auth/character-token-store.js', () => ({
  findCharacterCacheAuthorizationForLifecycle: mocks.authorization,
}))
vi.mock('../src/auth/tokens.js', () => ({ schedulePendingCharacterTokenRecovery: vi.fn() }))
vi.mock('../src/db/client.js', () => ({ db: { select: () => mocks.types } }))
vi.mock('../src/esi-gateway/feature-execution.js', () => createFeatureExecutionMock(mocks.execute))
vi.mock('../src/universe/names.js', () => ({ resolveUniverseNamesBestEffort: mocks.names }))
vi.mock('../src/universe/static-locations.js', () => ({ getStaticLocations: mocks.locations }))

import { applicationScalars } from '../src/graphql/scalars.js'
import {
  coreCharacterResolvers,
  coreCharacterTypeDefs,
} from '../src/graphql/core-character-schema.js'
import { createCoreCharacterReads } from '../src/graphql/core-character-reads.js'
import { GraphQLRequestState } from '../src/graphql/request-state.js'

const character = {
  characterId: 90000001,
  name: 'Pilot',
  isMain: false,
  corporationId: 1,
  allianceId: null,
  subjectLifecycleId: '11111111-1111-4111-8111-111111111111',
}
const owner = {
  userId: 'owner-a',
  mainCharacter: { ...character, characterId: 90000002, isMain: true },
}
const schema = createSchema({
  typeDefs: [
    `scalar EveId\nscalar BigInteger\nscalar UTCTime\ntype Query { public: Boolean }`,
    coreCharacterTypeDefs,
  ],
  resolvers: {
    ...coreCharacterResolvers,
    EveId: applicationScalars.EveId,
    BigInteger: applicationScalars.BigInteger,
    UTCTime: applicationScalars.UTCTime,
  },
})
const liveSession = vi.fn<() => Promise<typeof owner | null>>(async () => owner)
const run = (source: string, variableValues = {}, signal = new AbortController().signal) => {
  const state = new GraphQLRequestState(signal)
  return graphql({
    schema,
    source,
    variableValues,
    contextValue: { characters: createCoreCharacterReads(liveSession, state, state) },
  })
}
const query = `query($id: EveId! = "90000001", $first: Int! = 25, $after: String) {
  ownedCharacter(characterId: $id) { characterId isMain assets(first: $first, after: $after) {
    assets { itemId typeId quantity typeName customName locationName }
    sourcePage totalSourcePages completeness source { validatedAt cachedUntil stale }
    enrichment { types names locations } pageInfo { hasNextPage endCursor restartRequired }
  } }
}`

beforeEach(() => {
  vi.clearAllMocks()
  liveSession.mockResolvedValue(owner)
  mocks.owned.mockImplementation(async (_user, id) =>
    id === character.characterId ? character : null,
  )
  mocks.authorization.mockResolvedValue({ tokenVersion: 3, scopes: ['esi-assets.read_assets.v1'] })
  mocks.page.mockResolvedValue({
    items: [{ characterId: character.characterId, name: character.name, isMain: false }],
    hasNextPage: false,
  })
  mocks.types.from.mockReturnValue(mocks.types)
  mocks.types.leftJoin.mockReturnValue(mocks.types)
  mocks.types.where.mockReturnValue(mocks.types)
  mocks.types.limit.mockResolvedValue([])
  mocks.names.mockResolvedValue({ complete: true, names: new Map() })
  mocks.locations.mockResolvedValue([])
  mocks.execute.mockImplementation(async (definition, input) => ({
    data:
      definition.operation === 'character-asset-names'
        ? []
        : {
            page: input.page,
            totalPages: 1000,
            assets: Array.from({ length: 1000 }, (_, i) => ({
              itemId: 1000000000000 + input.page * 1000 + i,
              typeId: 34,
              quantity: 1,
              isSingleton: true,
              isBlueprintCopy: null,
              locationId: 1035466617946,
              locationType: 'other',
              locationFlag: 'Hangar',
              parentItemId: null,
            })),
          },
    validatedAt: '2026-10-01T10:00:00.000Z',
    cachedUntil: '2099-10-01T11:00:00.000Z',
    stale: false,
  }))
})

describe('core owned character GraphQL reads', () => {
  test('selects minimal attached identities without private or optional resource fan-out', async () => {
    const result = await run(
      '{ ownedCharacters { items { characterId name isMain } pageInfo { hasNextPage restartRequired } } }',
    )
    expect(result.errors).toBeUndefined()
    expect(result.data?.ownedCharacters).toMatchObject({
      items: [{ characterId: '90000001', name: 'Pilot', isMain: false }],
    })
    expect(mocks.page).toHaveBeenCalledWith('owner-a', 50, 0)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.authorization).not.toHaveBeenCalled()
    expect(mocks.names).not.toHaveBeenCalled()
    expect(mocks.locations).not.toHaveBeenCalled()
  })

  test('the minimal selector exposes no nested asset enrichment', async () => {
    const result = await run('{ ownedCharacters { items { assets { assets { itemId } } } } }')
    expect(result.errors).toHaveLength(1)
    expect(mocks.page).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  test.each([0, 51])('rejects selector size %s without a database read', async (first) => {
    const result = await run(`{ ownedCharacters(first: ${first}) { items { characterId } } }`)
    expect(result.errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT')
    expect(mocks.page).not.toHaveBeenCalled()
  })

  test('rejects a selector cursor from another owner before reading', async () => {
    const after = Buffer.from(JSON.stringify({ version: 1, owner: 'other', after: 1 })).toString(
      'base64url',
    )
    const result = await run(
      'query($after: String) { ownedCharacters(after: $after) { items { characterId } } }',
      { after },
    )
    expect(result.errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT')
    expect(mocks.page).not.toHaveBeenCalled()
  })

  test('does not release identities after a session change or detach', async () => {
    liveSession.mockResolvedValueOnce(owner).mockResolvedValueOnce(null)
    expect(
      (await run('{ ownedCharacters { items { characterId } } }')).data?.ownedCharacters,
    ).toBeNull()
    liveSession.mockResolvedValue(owner)
    mocks.page
      .mockResolvedValueOnce({ items: [character], hasNextPage: false })
      .mockResolvedValueOnce({ items: [], hasNextPage: false })
    expect(
      (await run('{ ownedCharacters { items { characterId } } }')).errors?.[0]?.extensions.code,
    ).toBe('BAD_USER_INPUT')
  })

  test('loads only selected singleton names and one source page for a small inventory window', async () => {
    const result = await run(query)
    expect(result.errors).toBeUndefined()
    expect(result.data?.ownedCharacter).toMatchObject({
      characterId: '90000001',
      isMain: false,
      assets: {
        sourcePage: 1,
        totalSourcePages: 1000,
        completeness: 'source-page',
        assets: expect.arrayContaining([
          {
            itemId: '1000000001000',
            typeId: '34',
            quantity: '1',
            typeName: 'Unknown type 34',
            customName: null,
            locationName: null,
          },
        ]),
        enrichment: { types: 'partial', names: 'partial', locations: 'complete' },
      },
    })
    const sourceCalls = mocks.execute.mock.calls.filter(
      ([definition]) => definition.operation === 'character-assets-page',
    )
    const names = mocks.execute.mock.calls.find(
      ([definition]) => definition.operation === 'character-asset-names',
    )
    expect(sourceCalls).toHaveLength(1)
    expect(names?.[1].body).toHaveLength(25)
    expect(names?.[1].path.character_id).toBe(character.characterId)
  })

  test('isolates owned, non-owned and unknown aliases', async () => {
    const result = await run(
      '{ mine: ownedCharacter(characterId: "90000001") { characterId } other: ownedCharacter(characterId: "90000002") { assets { assets { itemId } } } unknown: ownedCharacter(characterId: "99") { characterId } }',
    )
    expect(result.data).toMatchObject({
      mine: { characterId: '90000001' },
      other: null,
      unknown: null,
    })
    expect(result.errors?.map((error) => error.extensions.code)).toEqual([
      'CHARACTER_NOT_FOUND',
      'CHARACTER_NOT_FOUND',
    ])
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  test('requires member session and exact asset scope', async () => {
    liveSession.mockResolvedValue(null)
    expect((await run(query)).errors?.[0]?.extensions.code).toBe('AUTH_REQUIRED')
    expect(mocks.owned).not.toHaveBeenCalled()
    liveSession.mockResolvedValue(owner)
    mocks.authorization.mockResolvedValue({ tokenVersion: 3, scopes: [] })
    const result = await run(query)
    expect(result.errors?.[0]?.extensions).toMatchObject({
      code: 'EVE_SCOPE_REQUIRED',
      requiredScope: 'esi-assets.read_assets.v1',
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  test('rejects a revision change during the asset read before releasing rows', async () => {
    mocks.types.limit.mockImplementation(async () => {
      mocks.authorization.mockResolvedValue({
        tokenVersion: 4,
        scopes: ['esi-assets.read_assets.v1'],
      })
      return []
    })
    const result = await run(query)
    expect(result.errors?.[0]?.extensions.code).toBe('CHARACTER_AUTHORIZATION_CHANGED')
    expect(result.data?.ownedCharacter).toMatchObject({ assets: null })
  })

  test('aborting a pending source prevents subsequent singleton-name and enrichment work', async () => {
    const source = createDeferred<never>()
    mocks.execute.mockReturnValue(source.promise)
    const controller = new AbortController()
    const pending = run(query, {}, controller.signal)
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce())
    controller.abort(new Error('Disconnected'))
    const result = await pending
    expect(result.data?.ownedCharacter).toMatchObject({ assets: null })
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.types.limit).not.toHaveBeenCalled()
    source.reject(new Error('Source canceled'))
  })
})
