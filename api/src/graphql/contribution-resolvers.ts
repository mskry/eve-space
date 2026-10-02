import { Kind } from 'graphql'
import type { PlatformInstalledGraphQLContribution } from '@eve-space/platform-module-contract/graphql'
import { createInstalledGraphQLRead, type GraphQLReadContext } from './request-execution.js'
import { validateContributionSchema } from './contribution-schema.js'
import { safeGraphQLError } from './errors.js'

type ContributionResolver = (
  parent: unknown,
  args: Readonly<Record<string, unknown>>,
  context: GraphQLReadContext,
) => unknown

const projectProperty = (parent: unknown, field: string): unknown => {
  if (parent === null || typeof parent !== 'object') return undefined
  const property = Object.getOwnPropertyDescriptor(parent, field)
  if (!property) return undefined
  if (!('value' in property) || typeof property.value === 'function')
    throw new Error('Undeclared GraphQL executable projection')
  return property.value
}

export const createContributionResolvers = (contribution: PlatformInstalledGraphQLContribution) => {
  const document = validateContributionSchema(contribution)
  const resolvers: Record<string, Record<string, ContributionResolver>> = {}
  for (const definition of document.definitions) {
    if (
      definition.kind !== Kind.OBJECT_TYPE_DEFINITION &&
      definition.kind !== Kind.OBJECT_TYPE_EXTENSION
    )
      continue
    resolvers[definition.name.value] = Object.fromEntries(
      (definition.fields ?? []).map((field) => {
        const name = field.name.value
        const identity = `${definition.name.value}.${name}`
        const hasRead = contribution.reads.some((binding) => binding.field === identity)
        if (!hasRead) return [name, (parent: unknown) => projectProperty(parent, name)]
        const bound = createInstalledGraphQLRead(contribution, identity)
        const resolve: ContributionResolver = async (parent, args, context) => {
          try {
            return await context.execution.execute(bound, parent, args)
          } catch (error) {
            throw safeGraphQLError(error)
          }
        }
        return [name, resolve]
      }),
    )
  }
  return resolvers
}
