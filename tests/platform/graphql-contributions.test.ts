import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  compilePlatformModules,
  readCompiledPlatformModules,
} from '@eve-space/platform-module-contract/compiler'
import type { PlatformModuleManifest } from '@eve-space/platform-module-contract/manifest'
import type {
  PlatformGraphQLContribution,
  PlatformGraphQLDefinition,
} from '@eve-space/platform-module-contract/graphql'
import {
  composeContributionSDL,
  validateContributionSchema,
} from '@eve-space/platform-module-conformance/graphql'
import { readGraphQLArtifactContributions } from '@eve-space/platform-module-conformance/graphql-artifact'
import { coreModuleValidationAuthorities } from '../../scripts/module-registry/authorities'
import { canonicalizePersistenceRoutineSql } from '@eve-space/platform-module-persistence-policy/persistence-policy'
import { generateRegistryFiles } from '../../scripts/module-registry/generator'
import { platformModuleContractImportViolations } from '../../scripts/verify-platform-module-contract-boundaries'

const fixturePath = new URL(
  '../../packages/platform-module-conformance/test/fixtures/release/manifest/manifest.json',
  import.meta.url,
)
const manifest = (): PlatformModuleManifest => JSON.parse(readFileSync(fixturePath, 'utf8'))
const compile = (declarations: readonly PlatformModuleManifest[]) =>
  compilePlatformModules(
    declarations.map((declaration) => ({ declaration, expectedModuleId: declaration.id })),
    coreModuleValidationAuthorities,
  )
const descriptor = (): PlatformGraphQLContribution => manifest().server.graphql![0]!
const definition = (): PlatformGraphQLDefinition => ({
  typeDefs: 'extend type Query { fixture: FixtureRead } type FixtureRead { value: String }',
  reads: { 'Query.fixture': () => ({}), 'FixtureRead.value': () => 'value' },
})

const contributionWithListDefault = (
  argument: string,
  argumentName: string,
  defaultSize: number,
) => {
  const contribution = descriptor()
  const reads = contribution.reads.map((read) => {
    if (read.id !== 'value') return read
    return { ...read, list: { argument: argumentName, defaultSize, maximum: 100 } }
  })
  return {
    ...contribution,
    reads,
    definition: {
      ...definition(),
      typeDefs: `extend type Query { fixture: FixtureRead } type FixtureRead { value(${argument}): String }`,
    },
  }
}

const reviewedRoutine = async (declaration: PlatformModuleManifest) => {
  const operation = declaration.server.persistenceOperations[0]!
  const sql = readFileSync(
    new URL(
      '../../packages/platform-module-conformance/test/fixtures/release/server/migrations/fixture-001.sql',
      import.meta.url,
    ),
    'utf8',
  ).replaceAll('fixture', declaration.id)
  return {
    ...(await canonicalizePersistenceRoutineSql({
      moduleId: declaration.id,
      operationId: operation.id,
      mode: operation.mode,
      revision: operation.revision,
      sql,
    })),
    migration: operation.migration,
  }
}

it.each(['compiler', 'manifest'])(
  'authorizes the GraphQL compiler fixture to import %s',
  (subpath) => {
    const specifier = `@eve-space/platform-module-contract/${subpath}`
    expect(
      platformModuleContractImportViolations(
        'tests/platform/graphql-contributions.test.ts',
        specifier,
      ),
    ).toEqual([])
    expect(
      platformModuleContractImportViolations(
        'tests/platform/unregistered-graphql.test.ts',
        specifier,
      ),
    ).toEqual([
      `tests/platform/unregistered-graphql.test.ts: repository tests cannot import ${subpath}`,
    ])
  },
)

describe('GraphQL manifest contracts', () => {
  it('normalizes legacy absence and freezes independent exact read grants', () => {
    const legacy = manifest()
    Object.assign(legacy.server, { graphql: undefined })
    expect(readCompiledPlatformModules(compile([legacy]))[0]?.server.graphql).toEqual([])
    const compiled = readCompiledPlatformModules(compile([manifest()]))[0]!
    expect(Object.isFrozen(compiled.server.graphql![0]!.reads)).toBe(true)
    expect(
      compiled.server.graphql![0]!.reads.find(({ id }) => id === 'root')!.persistenceOperations,
    ).toEqual([])
  })

  it.each([
    ['reserved root', { rootField: 'ownedCharacter' }],
    ['cross-owner type', { types: ['MarketRead'] }],
    ['duplicate type', { types: ['FixtureRead', 'FixtureRead'] }],
    ['export collision', { exportName: 'fixtureRoutes' }],
    ['invalid contribution', { id: '../root' }],
    ['subscription', { types: ['Subscription'] }],
    ['mutation', { types: ['Mutation'] }],
  ])('rejects %s inventories', (_name, mutation) => {
    const value = manifest()
    Object.assign(value.server.graphql![0]!, mutation)
    expect(() => compile([value])).toThrow('Invalid platform module declarations')
  })

  it.each([
    { strategy: 'deployment-administrator' },
    { strategy: 'organization-reviewer' },
    { strategy: 'owned-character' },
    { strategy: 'organization-member' },
    { field: 'MarketRead.value' },
    { field: 'Mutation.fixture' },
    { id: '../read' },
    { cost: 0 },
    { sourceCost: -1 },
    { list: { argument: 'first', defaultSize: 101, maximum: 100 } },
    { persistenceOperations: [{ operationId: 'unknown' }] },
    { persistenceOperations: [{ operationId: 'read-fixture' }, { operationId: 'read-fixture' }] },
    { coreDataProducts: ['unknown-product'] },
    { onDemandResourceId: 'fixture' },
    { subjectArgument: 'characterId' },
    { requiredScope: 'esi-assets.read_assets.v1' },
    { organization: { audience: 'member', requiredPermission: 'fixture.view' } },
  ])('rejects incompatible read declaration %j', (mutation) => {
    const value = manifest()
    Object.assign(value.server.graphql![0]!.reads[0]!, mutation)
    expect(() => compile([value])).toThrow('Invalid platform module declarations')
  })

  it('rejects write grants and detects full installed root collisions deterministically', () => {
    const value = manifest()
    Object.assign(value.server.persistenceOperations[0]!, { mode: 'write' })
    expect(() => compile([value])).toThrow('non-read persistence')
    const collision = manifest()
    Object.assign(collision.server, {
      graphql: [
        ...collision.server.graphql!,
        { ...descriptor(), id: 'second', exportName: 'secondGraphQL' },
      ],
    })
    expect(() => compile([collision])).toThrow('collides')
  })
})

describe('GraphQL executable field kinds and list defaults', () => {
  it.each(['public', 'owned-character'] as const)(
    'rejects %s read bindings on input objects',
    (strategy) => {
      const read = { ...descriptor().reads[1]!, field: 'FixtureInput.value', strategy }
      const contribution = {
        ...descriptor(),
        types: ['FixtureRead', 'FixtureInput'],
        reads: [descriptor().reads[0]!, read],
        definition: {
          typeDefs:
            'extend type Query { fixture: FixtureRead } type FixtureRead { value: String } input FixtureInput { value: String }',
          reads: { 'Query.fixture': () => ({}), 'FixtureInput.value': () => 'input read' },
        },
      }
      expect(() => composeContributionSDL([contribution])).toThrow(
        'Non-executable GraphQL field FixtureInput.value',
      )
    },
  )

  it.each([
    ['EveId list', 'ids: [EveId!] = ["34", "35"]', 'ids', 2],
    ['singleton integer list', 'ids: [Int!] = 35', 'ids', 1],
    ['singleton ID list', 'ids: [EveId!] = "34"', 'ids', 1],
    ['non-null list', 'ids: [EveId!]! = ["34", "35"]', 'ids', 2],
    ['integer page size', 'first: Int = 2', 'first', 2],
  ] as const)(
    'accepts coerced default cardinality for %s',
    (_name, argument, argumentName, defaultSize) => {
      const contribution = contributionWithListDefault(argument, argumentName, defaultSize)
      expect(composeContributionSDL([contribution])).toContain('value(')
    },
  )

  it.each([
    ['ids: [EveId!] = ["34", "35"]', 'ids', 1],
    ['ids: [Int!] = 35', 'ids', 35],
    ['ids: [Int!] = ["invalid"]', 'ids', 1],
    ['ids: [Int!] = null', 'ids', 1],
    ['ids: [Int!] = []', 'ids', 1],
    ['first: Int = 2', 'first', 1],
  ] as const)(
    'rejects invalid or mismatched coerced defaults %s',
    (argument, argumentName, defaultSize) => {
      const contribution = contributionWithListDefault(argument, argumentName, defaultSize)
      expect(() => composeContributionSDL([contribution])).toThrow(
        'GraphQL list default mismatch FixtureRead.value',
      )
    },
  )
})

describe('GraphQL artifact callable bindings', () => {
  const inspect = (prefix: string, resolver: string) =>
    readGraphQLArtifactContributions(
      {
        read: async () =>
          `${prefix}\nexport const fixtureGraphQL = { typeDefs: ${JSON.stringify(definition().typeDefs)}, reads: { 'Query.fixture': () => ({}), 'FixtureRead.value': ${resolver} } }`,
      },
      'dist/index.js',
      [descriptor()],
    )

  it.each([
    ['', 'undefined'],
    ['', 'unknownRead'],
    ['const resolver = undefined', 'resolver'],
    ['const resolver = 42', 'resolver'],
    ['const resolver = "not callable"', 'resolver'],
    ['const resolver = {}', 'resolver'],
    ['let resolver = () => "mutable"', 'resolver'],
    ['const first = second; const second = first', 'first'],
    ['const definePlatformGraphQLRead = () => undefined', 'definePlatformGraphQLRead(() => null)'],
    [
      'import { definePlatformGraphQLRead } from "@eve-space/platform-module-contract/graphql"',
      'definePlatformGraphQLRead(undefined)',
    ],
    ['import { externalRead } from "./reader.js"', 'externalRead'],
  ])('rejects unproven callable binding %s / %s', async (prefix, resolver) => {
    await expect(inspect(prefix, resolver)).rejects.toThrow(/GraphQL/)
  })

  it.each([
    ['function resolver() { return "value" }', 'resolver'],
    ['const resolver = () => "value"', 'resolver'],
    ['const first = () => "value"; const resolver = first', 'resolver'],
    [
      'import { definePlatformGraphQLRead } from "@eve-space/platform-module-contract/graphql"; const reader = () => "value"',
      'definePlatformGraphQLRead(reader)',
    ],
    [
      'import { definePlatformGraphQLRead as defineRead } from "@eve-space/platform-module-contract/graphql"',
      'defineRead(() => "value")',
    ],
  ])('accepts statically established callable binding %s / %s', async (prefix, resolver) => {
    const contributions = await inspect(prefix, resolver)
    expect(composeContributionSDL(contributions)).toContain('fixture: FixtureRead')
  })
})

it('searches shared wildcard targets without mistaking a diamond for an export cycle', async () => {
  const source = `export const fixtureGraphQL = { typeDefs: ${JSON.stringify(definition().typeDefs)}, reads: { 'Query.fixture': () => ({}), 'FixtureRead.value': () => 'value' } }`
  const files = new Map([
    [
      'dist/index.js',
      "export * from './empty.js'; export * from './routes.js'; export * from './read-entry.js'",
    ],
    ['dist/empty.js', ''],
    ['dist/routes.js', "export * from './shared.js'"],
    ['dist/read-entry.js', "export * from './shared.js'; export * from './graphql.js'"],
    ['dist/shared.js', 'export const unrelated = true'],
    ['dist/graphql.js', source],
  ])
  const contributions = await readGraphQLArtifactContributions(
    { read: async (path) => files.get(path) },
    'dist/index.js',
    [descriptor()],
  )
  expect(composeContributionSDL(contributions)).toContain('fixture: FixtureRead')
})

it.each([
  ["export * from './missing.js'", 'Missing GraphQL descriptor artifact'],
  ["export { fixtureGraphQL } from './unrelated.js'", 'Missing GraphQL descriptor export'],
  ["export * from './invalid.js'", 'Unresolved static GraphQL binding undefined'],
  ["export * from './cycle.js'", 'GraphQL descriptor export cycle or limit'],
])('preserves wildcard/named export failures for %s', async (entry, message) => {
  const files = new Map([
    ['dist/index.js', entry],
    ['dist/unrelated.js', 'export const unrelated = true'],
    ['dist/invalid.js', 'export const fixtureGraphQL = undefined'],
    ['dist/cycle.js', "export * from './index.js'"],
  ])
  await expect(
    readGraphQLArtifactContributions({ read: async (path) => files.get(path) }, 'dist/index.js', [
      descriptor(),
    ]),
  ).rejects.toThrow(message)
})

describe('GraphQL executable and SDL composition', () => {
  it('validates nested bindings and emits stable accepted schema/registry artifacts', async () => {
    const contribution = { ...descriptor(), definition: definition() }
    const sdl = composeContributionSDL([contribution])
    const compiled = compile([manifest()])
    expect(() => generateRegistryFiles(compiled)).toThrow('validated executable artifacts')
    const routine = await reviewedRoutine(manifest())
    const files = generateRegistryFiles(compiled, [routine], [], [contribution])
    expect(files.get('api/src/generated/platform/installed-module-graphql.graphql')).toBe(sdl)
    expect(files.get('api/src/generated/platform/installed-module-persistence.ts')).toContain(
      'public-read/value',
    )
    const reversed = manifest()
    Object.assign(reversed.server.graphql![0]!, {
      reads: reversed.server.graphql![0]!.reads.toReversed(),
    })
    expect(generateRegistryFiles(compile([reversed]), [routine], [], [contribution])).toEqual(files)
    const other: PlatformModuleManifest = JSON.parse(
      JSON.stringify(manifest())
        .replaceAll('fixture', 'fixturetwo')
        .replaceAll('FixtureRead', 'FixturetwoRead'),
    )
    const otherContribution = {
      ...other.server.graphql![0]!,
      definition: {
        typeDefs: definition()
          .typeDefs.replaceAll('fixture', 'fixturetwo')
          .replaceAll('FixtureRead', 'FixturetwoRead'),
        reads: { 'Query.fixturetwo': () => ({}), 'FixturetwoRead.value': () => 'second' },
      },
    }
    const forwardSDL = composeContributionSDL([contribution, otherContribution])
    expect(composeContributionSDL([otherContribution, contribution])).toBe(forwardSDL)
    const routines = [routine, await reviewedRoutine(other)]
    expect(
      generateRegistryFiles(
        compile([manifest(), other]),
        routines,
        [],
        [contribution, otherContribution],
      ),
    ).toEqual(
      generateRegistryFiles(
        compile([other, manifest()]),
        routines,
        [],
        [otherContribution, contribution],
      ),
    )
  })

  it.each([
    { reads: { 'Query.fixture': () => ({}) } },
    { reads: { ...definition().reads, 'FixtureRead.hidden': () => 'hidden' } },
    {
      typeDefs:
        'extend type Query { fixture: FixtureRead } type FixtureRead { value: String hidden: MarketRead }',
    },
    { typeDefs: 'extend type Query { fixture: FixtureRead! } type FixtureRead { value: String }' },
    {
      typeDefs: 'extend type Query { fixture: FixtureRead } type FixtureRead { value: [String!]! }',
    },
    {
      typeDefs:
        'extend type Query { fixture: FixtureRead } type FixtureRead { value: String } type FixtureExtra { id: ID }',
    },
    { typeDefs: 'extend type Query { fixture: FixtureRead } type FixtureRead { value: Missing }' },
    { typeDefs: 'type Mutation { fixture: String }' },
  ])('rejects missing, excess, unbounded or cross-owner SDL/reads %j', (mutation) => {
    expect(() =>
      validateContributionSchema({ ...descriptor(), definition: { ...definition(), ...mutation } }),
    ).toThrow(/GraphQL/)
  })

  it('inspects packaged descriptor exports without evaluating package code', async () => {
    const source = `throw new Error('must never execute'); export const fixtureGraphQL = { typeDefs: ${JSON.stringify(definition().typeDefs)}, reads: { 'Query.fixture': () => ({}), 'FixtureRead.value': () => 'value' } }`
    const contributions = await readGraphQLArtifactContributions(
      { read: async () => source },
      'dist/index.js',
      [descriptor()],
    )
    expect(composeContributionSDL(contributions)).toContain('fixture: FixtureRead')
    await expect(
      readGraphQLArtifactContributions(
        { read: async () => source.replace("'FixtureRead.value'", "'FixtureRead.hidden'") },
        'dist/index.js',
        [descriptor()],
      ),
    ).rejects.toThrow('inventory')
  })
})
