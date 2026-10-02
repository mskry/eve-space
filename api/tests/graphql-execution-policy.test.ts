import { buildSchema, getIntrospectionQuery, GraphQLError } from 'graphql'
import { expect, test } from 'vitest'
import {
  analyzeGraphQLSelection,
  type GraphQLFieldPolicy,
} from '../src/graphql/execution-policy.js'
import { applicationGraphQLSchema, applicationGraphQLPolicies } from '../src/graphql/schema.js'

const schema = buildSchema(
  'type Query { rows(first: Int = 100): [Row!] secret: String scalar: String } type Row { id: ID! children(first: Int = 100): [Row!] }',
)
const policies: readonly GraphQLFieldPolicy[] = [
  {
    field: 'Query.rows',
    protected: false,
    cost: 1,
    sourceCost: 2,
    list: { argument: 'first', defaultSize: 100, maximum: 100 },
  },
  {
    field: 'Row.children',
    protected: false,
    cost: 1,
    sourceCost: 1,
    list: { argument: 'first', defaultSize: 100, maximum: 100 },
  },
  { field: 'Query.secret', protected: true, cost: 1, sourceCost: 0 },
]
const analyze = (query: string, variables = {}, operation?: string) =>
  analyzeGraphQLSelection(schema, query, operation, variables, policies)

const aliases = (count: number) =>
  `{ ${Array.from({ length: count }, (_, i) => `a${i}: scalar`).join(' ')} }`
const fields = (count: number) =>
  `{ ${Array.from({ length: count }, (_, i) => `a${i}: rows { id }`).join(' ')} }`

test('coerces variables anew and accounts for aliases, nested lists, fragments and directives', () => {
  const query =
    'query($size: Int!, $include: Boolean!) { rows(first: $size) { id children(first: $size) @include(if: $include) { id } } }'
  expect(analyze(query, { size: 10, include: true }).rows).toBe(110)
  expect(() => analyze(query, { size: 100, include: true })).toThrow(GraphQLError)
  expect(analyze(query, { size: 100, include: false }).rows).toBe(100)
  expect(() =>
    analyze(
      'query { ...A ...A } fragment A on Query { rows(first: 100) { children(first: 10) { id } } }',
    ),
  ).toThrow(GraphQLError)
  expect(analyze('{ secret @skip(if: true) rows(first: 1) { id } }').private).toBe(true)
})

test('selects one named operation and rejects ambiguous, cyclic and unsupported modes', () => {
  expect(
    analyze('query Cheap { scalar } query Large { rows { children { id } } }', {}, 'Cheap').rows,
  ).toBe(0)
  for (const query of [
    'query A { scalar } query B { scalar }',
    '{ ...A } fragment A on Query { ...A }',
    '{ rows @stream { id } }',
    '{ ... @defer { scalar } }',
  ])
    expect(() => analyze(query)).toThrow(GraphQLError)
})

test('rejects each finite document, token, field, alias, depth and read limit', () => {
  expect(analyze(aliases(30))).toMatchObject({ cost: 30 })
  expect(() => analyze(aliases(31))).toThrow(GraphQLError)
  expect(analyze(`{ ${'scalar '.repeat(500)} }`).cost).toBe(500)
  expect(() => analyze(`{ ${'scalar '.repeat(501)} }`)).toThrow(GraphQLError)
  expect(() => analyze(`{ scalar } #${'x'.repeat(16384)}`)).toThrow(GraphQLError)
  expect(() => analyze(`{ ${'scalar '.repeat(2001)} }`)).toThrow(GraphQLError)
  expect(() =>
    analyze(`{ rows(first: 1) { ${'children(first: 1) { '.repeat(10)}id${'}'.repeat(11)} }`),
  ).toThrow(GraphQLError)
  expect(() => analyze(`{ ${'secret '.repeat(13)} }`)).toThrow(GraphQLError)
  expect(() => analyze('{ rows(first: 101) { id } }')).toThrow(GraphQLError)
})

test('bounds combined domain rows and source cost, including small asset pages', () => {
  expect(analyze(fields(10)).rows).toBe(1000)
  expect(() => analyze(fields(11))).toThrow(GraphQLError)
  const source =
    '{ ownedCharacter(characterId: "90000001") { assets(first: 1) { assets { itemId } } } }'
  expect(
    analyzeGraphQLSelection(
      applicationGraphQLSchema,
      source,
      undefined,
      {},
      applicationGraphQLPolicies,
    ).cost,
  ).toBeGreaterThan(2000)
  const amplified = `{ ${Array.from({ length: 3 }, (_, i) => `a${i}: ownedCharacter(characterId: "90000001") { assets(first: 1) { assets { itemId } } }`).join(' ')} }`
  expect(() =>
    analyzeGraphQLSelection(
      applicationGraphQLSchema,
      amplified,
      undefined,
      {},
      applicationGraphQLPolicies,
    ),
  ).toThrow(GraphQLError)
})

test('supports bounded schema discovery under a separate finite expansion budget', () => {
  const source = getIntrospectionQuery({ typeDepth: 4 })
  expect(
    analyzeGraphQLSelection(
      applicationGraphQLSchema,
      source,
      undefined,
      {},
      applicationGraphQLPolicies,
    ),
  ).toMatchObject({ private: true, rows: 0 })
  const nested =
    '{ __schema { types { fields { type { fields { type { fields { name } } } } } } } }'
  expect(() =>
    analyzeGraphQLSelection(
      applicationGraphQLSchema,
      nested,
      undefined,
      {},
      applicationGraphQLPolicies,
    ),
  ).toThrow(GraphQLError)
})
