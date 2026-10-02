import { beforeEach, expect, it, vi } from 'vitest'
import { buildSchema, graphql, isObjectType } from 'graphql'
import type { PlatformInstalledGraphQLContribution } from '@eve-space/platform-module-contract/graphql'

const fixture = vi.hoisted(() => ({
  enabled: true,
  sectionEnabled: true,
  read: vi.fn(),
  root: vi.fn(),
  factory: vi.fn(),
  invoked: vi.fn(),
  owned: vi.fn(),
  authorization: vi.fn(),
  organization: vi.fn(),
}))
vi.mock('../src/auth/character-lifecycle.js', () => ({ findOwnedCharacter: fixture.owned }))
vi.mock('../src/auth/character-token-store.js', () => ({
  findCharacterCacheAuthorizationForLifecycle: fixture.authorization,
}))
vi.mock('../src/auth/tokens.js', () => ({ schedulePendingCharacterTokenRecovery: vi.fn() }))
vi.mock('../src/organization/read-admission.js', () => ({
  admitOrganizationRead: fixture.organization,
}))
vi.mock('../src/organization/session-context.js', () => ({
  loadOrganizationSessionContext: vi.fn(),
}))
vi.mock('../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: async (_module: string, section?: string) =>
    fixture.enabled && (!section || fixture.sectionEnabled),
}))
vi.mock('../src/db/client.js', () => ({ sql: {} }))
vi.mock('../src/db/module-persistence-operation-transaction.js', () => ({
  createStandaloneModulePersistenceOperationInvoker: () => fixture.invoked,
}))
vi.mock('../src/core-data/capabilities.js', () => ({
  createCoreDataCapability: fixture.factory,
}))
vi.mock('../src/generated/platform/installed-module-persistence.js', () => ({
  installedModulePersistenceCapabilityFactories: {},
  installedModulePersistenceOperations: [
    {
      moduleId: 'fixture',
      operationId: 'read-value',
      revision: 1,
      method: 'readValue',
      mode: 'read',
      grants: { graphqlReads: ['public-read/value'] },
    },
  ],
}))

const contributions: readonly PlatformInstalledGraphQLContribution[] = [
  {
    moduleId: 'fixture',
    publisherPackage: '@example/fixture-manifest',
    id: 'public-read',
    rootField: 'fixture',
    exportName: 'fixtureGraphQL',
    types: ['FixtureRead'],
    reads: [
      {
        id: 'root',
        field: 'Query.fixture',
        strategy: 'public',
        cost: 1,
        sourceCost: 0,
        coreDataProducts: [],
        persistenceOperations: [],
      },
      {
        id: 'value',
        field: 'FixtureRead.value',
        sectionId: 'catalogue',
        strategy: 'public',
        cost: 2,
        sourceCost: 1,
        coreDataProducts: ['market-catalogue'],
        persistenceOperations: [{ operationId: 'read-value' }],
      },
    ],
    definition: {
      typeDefs: 'extend type Query { fixture: FixtureRead } type FixtureRead { value: String }',
      reads: { 'Query.fixture': fixture.root, 'FixtureRead.value': fixture.read },
    },
  },
]
import { createContributionResolvers } from '../src/graphql/contribution-resolvers.js'
import { createGraphQLReadExecution } from '../src/graphql/request-execution.js'
import { createDeferred } from './support/deferred.js'

const contributionSchema = (contribution: PlatformInstalledGraphQLContribution) => {
  const resolvers = createContributionResolvers(contribution)
  const schema = buildSchema(
    `type Query { placeholder: Boolean } ${contribution.definition.typeDefs}`,
  )
  for (const [type, fields] of Object.entries(resolvers)) {
    const schemaType = schema.getType(type)
    if (!isObjectType(schemaType)) throw new Error('Missing fixture type')
    for (const [field, resolver] of Object.entries(fields))
      schemaType.getFields()[field]!.resolve = resolver
  }
  return schema
}

const context = (signal = new AbortController().signal) => {
  const liveSession = vi.fn()
  return {
    liveSession,
    execution: createGraphQLReadExecution({
      signal,
      liveSession,
      cache: { publicUntil: vi.fn(), noStore: vi.fn() },
    }),
  }
}

beforeEach(() => {
  fixture.enabled = true
  fixture.sectionEnabled = true
  fixture.invoked.mockReset()
  fixture.root.mockReturnValue({})
  fixture.factory.mockReturnValue({})
  fixture.read.mockImplementation(async ({ capabilities }) => {
    await capabilities.persistence.readValue()
    return 'value'
  })
})

it('composes offline without feature I/O and supplies exact field grants during reads', async () => {
  const resolvers = createContributionResolvers(contributions[0]!)
  expect(fixture.factory).not.toHaveBeenCalled()
  expect(fixture.read).not.toHaveBeenCalled()
  const request = context()
  expect(await resolvers.FixtureRead!.value!({}, {}, request)).toBe('value')
  expect(fixture.factory).toHaveBeenCalledWith(
    ['market-catalogue'],
    'graphql-read',
    request.execution.signal,
  )
  expect(fixture.invoked).toHaveBeenCalledWith(
    expect.objectContaining({ operationId: 'read-value', mode: 'read' }),
    undefined,
  )
  expect(request.liveSession).not.toHaveBeenCalled()
})

it.each(['module', 'section'])(
  'denies disabled %s fields before feature work, including aliases',
  async (kind) => {
    if (kind === 'module') fixture.enabled = false
    else fixture.sectionEnabled = false
    const contribution = contributions[0]!
    const schema = contributionSchema(contribution)
    const result = await graphql({
      schema,
      source: '{ a: fixture { value } b: fixture { value } }',
      contextValue: context(),
    })
    expect(result.errors).toHaveLength(2)
    expect(fixture.read).not.toHaveBeenCalled()
    expect(fixture.invoked).not.toHaveBeenCalled()
  },
)

it('rechecks runtime disablement before request-local reuse and release', async () => {
  const read = createContributionResolvers(contributions[0]!).FixtureRead!.value!
  const request = context()
  expect(await read({}, {}, request)).toBe('value')
  expect(await read({}, {}, request)).toBe('value')
  expect(fixture.read).toHaveBeenCalledTimes(1)
  fixture.sectionEnabled = false
  await expect(read({}, {}, request)).rejects.toThrow('Route not found')
  expect(fixture.read).toHaveBeenCalledTimes(1)
  fixture.sectionEnabled = true
  fixture.read.mockImplementationOnce(async () => {
    fixture.enabled = false
    return 'private retained value'
  })
  await expect(read({}, { distinct: true }, request)).rejects.toThrow('Route not found')
})

it('executes and reuses nested reads beneath a parent larger than the memo-key limit', async () => {
  fixture.root.mockReturnValue({ payload: 'x'.repeat(5_120) })
  const request = context()
  const result = await graphql({
    schema: contributionSchema(contributions[0]!),
    source: '{ fixture { a: value b: value } }',
    contextValue: request,
  })
  expect(result.errors).toBeUndefined()
  expect(result.data).toEqual({ fixture: { a: 'value', b: 'value' } })
  expect(fixture.root).toHaveBeenCalledOnce()
  expect(fixture.read).toHaveBeenCalledOnce()
})

it('keeps parent identity lossless and distinguishes result-changing parent data', async () => {
  fixture.read.mockImplementation(async ({ parent }) => typeof parent.number)
  const read = createContributionResolvers(contributions[0]!).FixtureRead!.value!
  const request = context()
  expect(await read({ number: 1n }, {}, request)).toBe('bigint')
  expect(await read({ number: '1' }, {}, request)).toBe('string')
  expect(await read({ number: 1n }, {}, request)).toBe('bigint')
  expect(fixture.read).toHaveBeenCalledTimes(2)
})

it('rejects undeclared callable or accessor DTO projections', () => {
  const contribution = contributions[0]!
  const definition = {
    ...contribution.definition,
    typeDefs:
      'extend type Query { fixture: FixtureRead } type FixtureRead { value: String label: String }',
  }
  const resolvers = createContributionResolvers({ ...contribution, definition })
  const label = resolvers.FixtureRead!.label!
  expect(label({ label: 'pure value' }, {}, context())).toBe('pure value')
  expect(() => label({ label: () => 'hidden read' }, {}, context())).toThrow('Undeclared')
  const getter = vi.fn(() => 'hidden read')
  expect(() => label(Object.defineProperty({}, 'label', { get: getter }), {}, context())).toThrow(
    'Undeclared',
  )
  expect(getter).not.toHaveBeenCalled()
})

it('executes the supplied descriptor and isolates replacements within a request', async () => {
  const original = contributions[0]!
  const replacement = vi.fn(({ capabilities }) => {
    expect(Object.keys(capabilities.persistence)).toEqual([])
    expect(Object.keys(capabilities.coreData)).toEqual([])
    return 'replacement'
  })
  const descriptor = {
    ...original,
    reads: original.reads.map((read) => ({
      ...read,
      persistenceOperations: [],
      coreDataProducts: [],
    })),
    definition: {
      ...original.definition,
      reads: { ...original.definition.reads, 'FixtureRead.value': replacement },
    },
  }
  const request = context()
  expect(await createContributionResolvers(original).FixtureRead!.value!({}, {}, request)).toBe(
    'value',
  )
  expect(await createContributionResolvers(descriptor).FixtureRead!.value!({}, {}, request)).toBe(
    'replacement',
  )
  expect(replacement).toHaveBeenCalledOnce()
  expect(fixture.invoked).toHaveBeenCalledOnce()
})

it('rechecks queued reads after a slot opens and never enters revoked capabilities', async () => {
  const entered = createDeferred<void>()
  const released = createDeferred<void>()
  fixture.invoked.mockImplementation(async () => {
    if (fixture.invoked.mock.calls.length === 4) entered.resolve()
    await released.promise
    return 'value'
  })
  const read = createContributionResolvers(contributions[0]!).FixtureRead!.value!
  const request = context()
  const results = Promise.allSettled(
    Array.from({ length: 5 }, (_, id) => read({}, { id }, request)),
  )
  await entered.promise
  fixture.sectionEnabled = false
  released.resolve()
  expect((await results).every((result) => result.status === 'rejected')).toBe(true)
  expect(fixture.read).toHaveBeenCalledTimes(5)
  expect(fixture.invoked).toHaveBeenCalledTimes(4)
})

it('cancels queued and active reads without releasing delayed values', async () => {
  const entered = createDeferred<void>()
  const released = createDeferred<void>()
  fixture.invoked.mockImplementation(async () => {
    if (fixture.invoked.mock.calls.length === 4) entered.resolve()
    await released.promise
    return 'late value'
  })
  const controller = new AbortController()
  const request = context(controller.signal)
  const read = createContributionResolvers(contributions[0]!).FixtureRead!.value!
  const results = Promise.allSettled(
    Array.from({ length: 5 }, (_, id) => read({}, { id }, request)),
  )
  await entered.promise
  controller.abort(new Error('Request cancelled'))
  expect((await results).every((result) => result.status === 'rejected')).toBe(true)
  released.resolve()
  expect(fixture.invoked).toHaveBeenCalledTimes(4)
  await expect(read({}, {}, request)).rejects.toThrow('Request cancelled')
})

it('rejects a session owner change while protected capability work is pending', async () => {
  const entered = createDeferred<void>()
  const released = createDeferred<void>()
  fixture.invoked.mockImplementation(async () => {
    entered.resolve()
    await released.promise
    return 'private value'
  })
  const original = contributions[0]!
  const descriptor = {
    ...original,
    reads: original.reads.map((read) =>
      Object.assign({}, read, { strategy: 'authenticated-session' as const }),
    ),
  }
  const request = context()
  request.liveSession.mockResolvedValue({ userId: 'first-user' })
  const read = createContributionResolvers(descriptor).FixtureRead!.value!
  const result = read({}, {}, request)
  await entered.promise
  request.liveSession.mockResolvedValue({ userId: 'second-user' })
  released.resolve()
  await expect(result).rejects.toThrow('Read authorization changed')
})

it('runs owned admission inside occupied slots and rejects token revision changes before release', async () => {
  const character = { characterId: 90000001, subjectLifecycleId: 'lifecycle-a' }
  fixture.owned.mockResolvedValue(character)
  fixture.authorization.mockResolvedValue({ tokenVersion: 1, scopes: ['assets'] })
  const original = contributions[0]!
  const descriptor = {
    ...original,
    reads: original.reads.map((read) =>
      read.id === 'value'
        ? {
            ...read,
            strategy: 'owned-character' as const,
            subjectArgument: 'characterId',
            requiredScope: 'assets',
          }
        : read,
    ),
    definition: {
      ...original.definition,
      typeDefs:
        'extend type Query { fixture: FixtureRead } type FixtureRead { value(characterId: EveId!): String }',
    },
  }
  const entered = createDeferred<void>()
  const released = createDeferred<void>()
  fixture.invoked.mockImplementation(async () => {
    if (fixture.invoked.mock.calls.length === 4) entered.resolve()
    await released.promise
    return 'private value'
  })
  const request = context()
  request.liveSession.mockResolvedValue({ userId: 'owner' })
  const read = createContributionResolvers(descriptor).FixtureRead!.value!
  const results = Promise.allSettled(
    Array.from({ length: 4 }, (_, id) => read({ id }, { characterId: '90000001' }, request)),
  )
  await entered.promise
  fixture.authorization.mockResolvedValue({ tokenVersion: 2, scopes: ['assets'] })
  released.resolve()
  for (const result of await results) {
    expect(result.status).toBe('rejected')
    expect(result).toMatchObject({
      status: 'rejected',
      reason: { message: 'Read authorization changed. Restart this read.' },
    })
  }
  expect(fixture.owned).toHaveBeenCalledWith('owner', 90000001)
})

it('charges actual capability invocations and stops a resolver after the shared work limit', async () => {
  fixture.read.mockImplementation(async ({ capabilities }) => {
    for (let index = 0; index < 33; index += 1) await capabilities.persistence.readValue()
    return 'unreachable'
  })
  const resolvers = createContributionResolvers(contributions[0]!)
  const request = context()
  await expect(resolvers.FixtureRead!.value!({}, {}, request)).rejects.toMatchObject({
    extensions: { code: 'OPERATION_LIMIT' },
  })
  expect(fixture.invoked).toHaveBeenCalledTimes(32)
  expect(request.execution.signal.aborted).toBe(true)
})

it('returns a path-addressed organization denial without creating read capabilities', async () => {
  fixture.organization.mockResolvedValue({
    admitted: false,
    status: 403,
    body: {
      code: 'ORGANIZATION_PERMISSION_REQUIRED',
      message: 'Organization permission is required.',
    },
  })
  const base = contributions[0]!
  const descriptor: PlatformInstalledGraphQLContribution = {
    ...base,
    reads: base.reads.map((read) =>
      read.id === 'value'
        ? Object.assign({}, read, {
            strategy: 'organization-member' as const,
            organization: { audience: 'member' as const, requiredPermission: 'fixture.read' },
          })
        : read,
    ),
  }
  const request = context()
  request.liveSession.mockResolvedValue({ userId: 'owner' })
  const result = await graphql({
    schema: contributionSchema(descriptor),
    source: '{ fixture { value } }',
    contextValue: request,
  })
  expect(result).toMatchObject({
    data: { fixture: { value: null } },
    errors: [
      {
        path: ['fixture', 'value'],
        extensions: { code: 'ORGANIZATION_PERMISSION_REQUIRED', status: 403 },
      },
    ],
  })
  expect(fixture.read).not.toHaveBeenCalled()
  expect(fixture.invoked).not.toHaveBeenCalled()
})
