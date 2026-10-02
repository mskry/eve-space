import { createSchema } from 'graphql-yoga'
import { graphqlCoreScalarTypeDefs } from '@eve-space/platform-module-conformance/graphql'
import { installedGraphQLContributions } from '../generated/platform/installed-module-graphql.js'
import { applicationScalars } from './scalars.js'
import { coreCharacterResolvers, coreCharacterTypeDefs } from './core-character-schema.js'
import { createContributionResolvers } from './contribution-resolvers.js'
import type { GraphQLFieldPolicy } from './execution-policy.js'

export const applicationGraphQLSchema = createSchema({
  typeDefs: [
    graphqlCoreScalarTypeDefs,
    coreCharacterTypeDefs,
    ...installedGraphQLContributions.map((item) => item.definition.typeDefs),
  ],
  resolvers: [
    applicationScalars,
    coreCharacterResolvers,
    ...installedGraphQLContributions.map(createContributionResolvers),
  ],
})

export const applicationGraphQLPolicies: readonly GraphQLFieldPolicy[] = [
  {
    field: 'Query.ownedCharacters',
    protected: true,
    cost: 1,
    sourceCost: 2,
    list: { argument: 'first', defaultSize: 50, maximum: 50 },
  },
  { field: 'Query.ownedCharacter', protected: true, cost: 1, sourceCost: 3 },
  {
    field: 'OwnedCharacter.assets',
    protected: true,
    cost: 1,
    sourceCost: 2000,
    list: { argument: 'first', defaultSize: 25, maximum: 100 },
  },
  {
    field: 'OwnedCharacterConnection.items',
    protected: true,
    cost: 1,
    sourceCost: 0,
    list: { defaultSize: 50, maximum: 50 },
    projection: true,
  },
  {
    field: 'AssetConnection.assets',
    protected: true,
    cost: 1,
    sourceCost: 0,
    list: { defaultSize: 100, maximum: 100 },
    projection: true,
  },
  ...installedGraphQLContributions.flatMap((contribution) =>
    contribution.reads.map((read) => ({
      field: read.field,
      protected: read.strategy !== 'public',
      cost: read.cost,
      sourceCost: read.sourceCost,
      list: read.list,
      projection:
        read.sourceCost === 0 &&
        !read.persistenceOperations.length &&
        !read.coreDataProducts.length,
    })),
  ),
]
