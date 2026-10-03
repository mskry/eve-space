import { readFile } from 'node:fs/promises'
import { lexicographicSortSchema, parse, print, printSchema, separateOperations } from 'graphql'
import { expect, test } from 'vitest'
import { applicationGraphQLSchema, applicationGraphQLPolicies } from '../src/graphql/schema.js'
import { analyzeGraphQLSelection } from '../src/graphql/execution-policy.js'

test('offline schema matches the actual composed application schema', async () => {
  const artifact = await readFile(
    new URL('../src/generated/graphql/application.graphql', import.meta.url),
    'utf8',
  )
  const expected = `${printSchema(lexicographicSortSchema(applicationGraphQLSchema))}\n`
  expect(artifact).toBe(expected)
})

const marketDocuments = separateOperations(
  parse(
    await readFile(
      new URL(
        '../../features/market/nuxt/src/runtime/app/market-operations.graphql',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
)

test.each(Object.entries(marketDocuments))(
  'Market %s fits the actual public selection policy',
  (operationName, document) => {
    const verdict = analyzeGraphQLSelection(
      applicationGraphQLSchema,
      print(document),
      operationName,
      {
        revision: 'fixture-revision',
        profileId: '00000000-0000-4000-8000-000000000001',
        observationId: '00000000-0000-4000-8000-000000000002',
        typeId: '587',
        side: 'sell',
        after: 'opaque',
      },
      applicationGraphQLPolicies,
    )
    expect(verdict.private).toBe(false)
    expect(verdict.cost).toBeLessThanOrEqual(5000)
    expect(verdict.rows).toBeLessThanOrEqual(1000)
  },
)

test.each([
  'ExplorerMarket',
  'ExplorerMarketBook',
  'ExplorerOwnedCharacters',
  'ExplorerOwnedAssets',
])('curated %s fits the deployed selection limits', async (operationName) => {
  const document = await readFile(
    new URL('../../app/graphql/operations.graphql', import.meta.url),
    'utf8',
  )
  const verdict = analyzeGraphQLSelection(
    applicationGraphQLSchema,
    document,
    operationName,
    {
      profileId: '00000000-0000-4000-8000-000000000001',
      typeId: '34',
      characterId: '7001',
      first: 25,
      after: null,
    },
    applicationGraphQLPolicies,
  )
  expect(verdict.cost).toBeLessThanOrEqual(5000)
})
