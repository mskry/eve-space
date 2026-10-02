import { readFile } from 'node:fs/promises'
import { lexicographicSortSchema, printSchema } from 'graphql'
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
