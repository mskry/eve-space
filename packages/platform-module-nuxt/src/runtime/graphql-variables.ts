import type { GraphQLInputValue, GraphQLVariables } from './graphql-values.js'

const normalizeValue = (value: GraphQLInputValue): GraphQLInputValue => {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value === null || Object(value) !== value) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, GraphQLInputValue] => entry[1] !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeValue(item)]),
  )
}

export const normalizeGraphQLVariables = (variables: GraphQLVariables) =>
  Object.fromEntries(
    Object.entries(variables)
      .filter((entry): entry is [string, GraphQLInputValue] => entry[1] !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeValue(value)]),
  )
