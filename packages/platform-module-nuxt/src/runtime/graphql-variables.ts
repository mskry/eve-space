import type { GraphQLJSONValue, GraphQLVariables } from './graphql-values.js'

const normalizeValue = (value: GraphQLJSONValue): GraphQLJSONValue => {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value === null || Object(value) !== value) return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeValue(item)]),
  )
}

export const normalizeGraphQLVariables = (variables: GraphQLVariables) =>
  Object.fromEntries(
    Object.entries(variables)
      .filter((entry): entry is [string, GraphQLJSONValue] => entry[1] !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeValue(value)]),
  )
