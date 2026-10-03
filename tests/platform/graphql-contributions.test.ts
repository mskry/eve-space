import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
import {
  generateRegistryFiles,
  loadInstalledModuleManifests,
} from '../../scripts/module-registry/generator'
import { platformModuleContractImportViolations } from '../../scripts/verify-platform-module-contract-boundaries'
import type {
  PlatformInventoryConsumerDeclaration,
  PlatformInventoryProviderDeclaration,
} from '@eve-space/platform-module-contract/inventory'
import { tradingGraphQL } from '../../features/trading/server/src/graphql'

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

const personalConsumer: PlatformInventoryConsumerDeclaration = {
  id: 'personal',
  contractVersion: 1,
  scope: 'personal',
  provider: 'core.character-assets',
  maximumSubjects: 20,
  maximumPageSize: 100,
}
const corporationConsumer: PlatformInventoryConsumerDeclaration = {
  id: 'corporation',
  contractVersion: 1,
  scope: 'corporation',
  provider: { moduleId: 'source', providerId: 'assets-inventory', optional: true },
  requiredPermission: 'fixture.inventory.corporation.read',
  sourcePermission: 'source.assets.read',
  maximumSubjects: 250,
  maximumPageSize: 100,
}
const inventoryProvider: PlatformInventoryProviderDeclaration = {
  id: 'assets-inventory',
  exportName: 'sourceInventory',
  contractVersion: 1,
  scope: 'corporation',
  sectionId: 'assets',
  requiredPermission: 'source.assets.read',
  maximumSubjects: 250,
  maximumPageSize: 100,
  persistenceOperations: [{ operationId: 'read-source' }],
}
const inventoryManifest = () => {
  const value = manifest()
  Object.assign(value.release, { hostContractRange: '^1.2.0' })
  Object.assign(value, {
    permissions: [
      ...value.permissions!,
      {
        key: 'fixture.inventory.corporation.read',
        label: 'Inventory',
        purpose: 'Review corporation inventory',
        audiences: ['hr', 'director'],
        sensitivity: 'sensitive',
        reviewAllowed: true,
      },
    ],
  })
  Object.assign(value.server, {
    inventoryConsumers: [structuredClone(personalConsumer), structuredClone(corporationConsumer)],
  })
  Object.assign(value.server.graphql![0]!, {
    reads: [
      descriptor().reads[0]!,
      {
        id: 'personal',
        field: 'FixtureRead.personal',
        strategy: 'personal-inventory',
        inventoryConsumerId: 'personal',
        subjectArgument: 'characterIds',
        requiredScope: 'esi-assets.read_assets.v1',
        cost: 1,
        sourceCost: 20,
        persistenceOperations: [],
        coreDataProducts: [],
      },
      {
        id: 'corporation',
        field: 'FixtureRead.corporation',
        strategy: 'reviewer-corporation-inventory',
        inventoryConsumerId: 'corporation',
        subjectArgument: 'corporationId',
        organization: {
          audience: 'director',
          requiredPermission: 'fixture.inventory.corporation.read',
          additionalRequiredPermissions: ['source.assets.read'],
        },
        cost: 1,
        sourceCost: 250,
        persistenceOperations: [],
        coreDataProducts: [],
      },
    ],
  })
  return value
}
const sourceManifest = (): PlatformModuleManifest => {
  const value: PlatformModuleManifest = JSON.parse(
    JSON.stringify(manifest())
      .replaceAll('fixture', 'source')
      .replaceAll('FixtureRead', 'SourceRead'),
  )
  Object.assign(value.release, { hostContractRange: '^1.2.0' })
  Object.assign(value, {
    permissions: [
      {
        key: 'source.assets.read',
        label: 'Assets',
        purpose: 'Review assets',
        audiences: ['hr', 'director'],
        sensitivity: 'sensitive',
        reviewAllowed: true,
      },
    ],
    sections: [
      { id: 'assets', kind: 'sensitive-evidence', defaultEnabled: false, disclosureRevision: 1 },
    ],
  })
  Object.assign(value.server, {
    routes: [],
    activityProviders: [],
    graphql: [],
    inventoryProviders: [structuredClone(inventoryProvider)],
  })
  Object.assign(value.nuxt, { pages: [], navigation: [] })
  return value
}
const inventoryDefinition = (): PlatformGraphQLDefinition => ({
  typeDefs:
    'extend type Query { fixture: FixtureRead } type FixtureRead { personal(characterIds: [EveId!]): String corporation(corporationId: EveId!): String }',
  reads: {
    'Query.fixture': () => ({}),
    'FixtureRead.personal': () => null,
    'FixtureRead.corporation': () => null,
  },
})

describe('inventory installed contracts', () => {
  it('emits independent personal and optional corporation bindings deterministically', async () => {
    const consumer = inventoryManifest()
    const source = sourceManifest()
    const contribution = { ...consumer.server.graphql![0]!, definition: inventoryDefinition() }
    const routines = [await reviewedRoutine(consumer), await reviewedRoutine(source)]
    const files = generateRegistryFiles(compile([consumer, source]), routines, [], [contribution])
    expect(
      generateRegistryFiles(compile([source, consumer]), routines, [], [contribution]),
    ).toEqual(files)
    const bindings = files.get(
      'api/src/generated/platform/installed-module-inventory-providers.ts',
    )!
    expect(bindings).toContain('definition: inventoryProvider0')
    expect(bindings).toContain('"providerAvailable":true')
    expect(files.get('api/src/generated/platform/installed-module-persistence.ts')).toContain(
      '"inventoryProviders":["assets-inventory"]',
    )
    const absent = generateRegistryFiles(
      compile([consumer]),
      [routines[0]!],
      [],
      [contribution],
    ).get('api/src/generated/platform/installed-module-inventory-providers.ts')!
    expect(absent).toContain('"providerAvailable":false')
    expect(absent).toContain('"scope":"personal"')
    expect(absent).toContain('"provider":"core.character-assets"')
  })

  it.each(['1.2.0', '>=1.2.0 <2.0.0', '1.2.x'])(
    'accepts an equivalent minimum host range: %s',
    (hostContractRange) => {
      const value = inventoryManifest()
      Object.assign(value.release, { hostContractRange })
      expect(() => compile([value])).not.toThrow()
    },
  )

  it.each(['>=1.1.1 <2.0.0', '^1.2.0 || ^1.1.5', '*'])(
    'rejects inventory releases allowing an older host: %s',
    (hostContractRange) => {
      const value = inventoryManifest()
      Object.assign(value.release, { hostContractRange })
      expect(() => compile([value])).toThrow('host contract 1.2.0')
    },
  )

  it.each([
    [
      'old host range',
      (value: PlatformModuleManifest) =>
        Object.assign(value.release, { hostContractRange: '^1.1.0' }),
      'host contract 1.2.0',
    ],
    [
      'duplicate consumer',
      (value: PlatformModuleManifest) =>
        Object.assign(value.server, { inventoryConsumers: [personalConsumer, personalConsumer] }),
      'duplicate inventory',
    ],
    [
      'excess grant',
      (value: PlatformModuleManifest) =>
        Object.assign(value.server.inventoryConsumers![0]!, { dispatch: '*' }),
      'is not allowed',
    ],
    [
      'incompatible version',
      (value: PlatformModuleManifest) =>
        Object.assign(value.server.inventoryConsumers![0]!, { contractVersion: 2 }),
      'incompatible inventory',
    ],
    [
      'unbounded subjects',
      (value: PlatformModuleManifest) =>
        Object.assign(value.server.inventoryConsumers![0]!, { maximumSubjects: 21 }),
      'invalid inventory bounds',
    ],
    [
      'missing mandatory provider',
      (value: PlatformModuleManifest) =>
        Object.assign(
          corporationConsumer.scope === 'corporation' &&
            value.server.inventoryConsumers![1]!.provider,
          { optional: false },
        ),
      'missing declared inventory provider',
    ],
  ] as const)('rejects %s', (_name, mutate, error) => {
    const value = inventoryManifest()
    mutate(value)
    expect(() => compile([value])).toThrow(error)
  })
})

describe('inventory source and GraphQL authority', () => {
  it('accepts HR/director inventory permissions while viewer compliance-review access stays disabled', () => {
    const consumer = inventoryManifest()
    const source = sourceManifest()
    for (const permission of [...consumer.permissions!, ...source.permissions!])
      Object.assign(permission, { reviewAllowed: false })
    expect(() => compile([consumer, source])).not.toThrow()
  })

  it.each([
    [
      'duplicate provider',
      (value: PlatformModuleManifest) =>
        Object.assign(value.server, { inventoryProviders: [inventoryProvider, inventoryProvider] }),
      'duplicate inventory',
    ],
    [
      'cross-schema operation',
      (value: PlatformModuleManifest) =>
        Object.assign(value.server.inventoryProviders![0]!, {
          persistenceOperations: [{ operationId: 'read-fixture' }],
        }),
      'cross-schema',
    ],
    [
      'write operation',
      (value: PlatformModuleManifest) =>
        Object.assign(value.server.persistenceOperations[0]!, { mode: 'write' }),
      'non-read',
    ],
    [
      'wrong source permission',
      (value: PlatformModuleManifest) =>
        Object.assign(value.server.inventoryProviders![0]!, {
          requiredPermission: 'source.other.read',
        }),
      'source permission',
    ],
    [
      'undersized provider',
      (value: PlatformModuleManifest) =>
        Object.assign(value.server.inventoryProviders![0]!, { maximumSubjects: 249 }),
      'incompatible inventory provider',
    ],
    [
      'missing declared provider',
      (value: PlatformModuleManifest) => Object.assign(value.server, { inventoryProviders: [] }),
      'missing declared inventory provider',
    ],
  ] as const)('rejects %s at installation', (_name, mutate, error) => {
    const source = sourceManifest()
    mutate(source)
    expect(() => compile([inventoryManifest(), source])).toThrow(error)
  })

  it.each([
    { strategy: 'authenticated-session' },
    { strategy: 'organization-reviewer' },
    { strategy: 'deployment-administrator' },
    { strategy: 'public-mutation' },
    { strategy: 'subscription' },
    { inventoryConsumerId: 'personal' },
    { subjectArgument: undefined },
    { sourceCost: 1 },
    { persistenceOperations: [{ operationId: 'read-fixture' }] },
    { organization: { audience: 'member', requiredPermission: 'fixture.view' } },
    {
      organization: {
        audience: 'hr',
        requiredPermission: 'fixture.inventory.corporation.read',
        additionalRequiredPermissions: ['source.other.read'],
      },
    },
  ])('rejects widened corporation GraphQL authority %j', (mutation) => {
    const value = inventoryManifest()
    Object.assign(value.server.graphql![0]!.reads[2]!, mutation)
    expect(() => compile([value])).toThrow('Invalid platform module declarations')
  })

  it('checks scope selectors in executable SDL without running providers', () => {
    const value = inventoryManifest()
    const contribution = { ...value.server.graphql![0]!, definition: inventoryDefinition() }
    expect(composeContributionSDL([contribution])).toContain('corporationId: EveId!')
    for (const [before, after] of [
      ['characterIds: [EveId!]', 'characterIds: EveId!'],
      ['corporationId: EveId!', 'corporationId: [EveId!]'],
    ] as const) {
      expect(() =>
        composeContributionSDL([
          {
            ...contribution,
            definition: {
              ...contribution.definition,
              typeDefs: contribution.definition.typeDefs.replace(before, after),
            },
          },
        ]),
      ).toThrow('argument')
    }
  })
})

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

describe('Trading package composition', () => {
  const trading: PlatformModuleManifest = JSON.parse(
    readFileSync(new URL('../../features/trading/manifest/manifest.json', import.meta.url), 'utf8'),
  )
  const memberAudit: PlatformModuleManifest = JSON.parse(
    readFileSync(
      new URL('../../features/member-audit/manifest/manifest.json', import.meta.url),
      'utf8',
    ),
  )
  it.each([false, true])(
    'composes Trading with the optional corporation provider present: %s',
    async (present) => {
      const compiled = compile(present ? [trading, memberAudit] : [trading])
      expect(
        readCompiledPlatformModules(compiled).find((item) => item.id === 'trading')?.server
          .inventoryConsumers,
      ).toHaveLength(2)
      const routines = present
        ? (
            await loadInstalledModuleManifests(fileURLToPath(new URL('../..', import.meta.url)))
          ).persistenceRoutines.filter((routine) => routine.identity.moduleId === 'member-audit')
        : []
      const output = generateRegistryFiles(
        compiled,
        routines,
        [],
        [{ ...trading.server.graphql![0]!, definition: tradingGraphQL }],
      )
      const inventory = output.get(
        'api/src/generated/platform/installed-module-inventory-providers.ts',
      )!
      expect(inventory).toContain(`"providerAvailable":${present}`)
      expect(inventory).toContain('"provider":"core.character-assets"')
    },
  )
})
