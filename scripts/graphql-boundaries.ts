import { posix } from 'node:path'
import { findDependencyCycles } from './dependency-cycles.js'
import { typescriptModuleSpecifiers } from './typescript-module-specifiers.js'

const importsByModule = {
  'cache-policy': [],
  'contribution-resolvers': [
    'graphql',
    '@eve-space/platform-module-contract/graphql',
    'api/src/graphql/request-execution.js',
    'api/src/graphql/contribution-schema.js',
    'api/src/graphql/errors.js',
  ],
  'contribution-schema': ['@eve-space/platform-module-conformance/graphql'],
  'core-character-reads': [
    'api/src/auth/admitted-read.js',
    'api/src/auth/character-selection.js',
    'api/src/auth/read-admission.js',
    'api/src/auth/read-policy.js',
    'api/src/auth/session-store.js',
    'api/src/characters/asset-connection.js',
    'api/src/characters/asset-pages.js',
    'api/src/characters/asset-work.js',
    'api/src/graphql/scalars.js',
    'api/src/graphql/request-state.js',
    'api/src/read-value.js',
  ],
  'core-character-types': [],
  'core-character-schema': [
    'api/src/graphql/core-character-types.js',
    'graphql',
    'api/src/auth/character-selection.js',
    'api/src/graphql/errors.js',
    'api/src/characters/asset-cursor.js',
    'api/src/characters/asset-pages.js',
    'api/src/graphql/core-character-reads.js',
  ],
  errors: [
    'graphql',
    'api/src/auth/read-policy.js',
    'api/src/auth/token-errors.js',
    'api/src/esi-gateway/failures.js',
    'zod',
  ],
  'execution-policy': ['graphql', 'api/src/type-guards.js'],
  graphiql: ['@graphql-yoga/render-graphiql', 'graphql-yoga'],
  'host-adapter': [
    'hono',
    'graphql',
    'graphql-yoga',
    'api/src/graphql/execution-policy.js',
    'api/src/graphql/request-state.js',
    'api/src/graphql/cache-policy.js',
    'api/src/graphql/response.js',
    'api/src/graphql/graphiql.js',
  ],
  'request-execution': [
    '@eve-space/platform-module-contract/graphql',
    'api/src/auth/session-store.js',
    'api/src/auth/read-work.js',
    'api/src/auth/read-policy.js',
    'api/src/platform/read-admission.js',
    'api/src/platform/module-route-capabilities.js',
    'api/src/read-value.js',
    'api/src/graphql/request-state.js',
    'api/src/graphql/cache-policy.js',
  ],
  'request-state': ['graphql', 'api/src/read-value.js'],
  response: ['graphql', 'zod', 'api/src/graphql/errors.js'],
  routes: [
    'zod',
    'api/src/auth/read-work.js',
    'api/src/middleware/auth-session.js',
    'api/src/logging.js',
    'api/src/graphql/host-adapter.js',
    'api/src/graphql/schema.js',
    'api/src/graphql/request-execution.js',
    'api/src/graphql/core-character-reads.js',
  ],
  scalars: ['graphql'],
  schema: [
    'graphql-yoga',
    '@eve-space/platform-module-conformance/graphql',
    'api/src/generated/platform/installed-module-graphql.js',
    'api/src/graphql/scalars.js',
    'api/src/graphql/core-character-schema.js',
    'api/src/graphql/contribution-resolvers.js',
    'api/src/graphql/execution-policy.js',
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>

export interface GraphQLSource {
  readonly path: string
  readonly source: string
}

const moduleName = (path: string) => posix.basename(path, '.ts')
const resolveImport = (path: string, specifier: string) =>
  specifier.startsWith('.')
    ? posix.normalize(posix.join(posix.dirname(path), specifier))
    : specifier

const sourceViolations = ({ path, source }: GraphQLSource): string[] => {
  const allowed: readonly string[] | undefined = Object.entries(importsByModule).find(
    ([module]) => module === moduleName(path),
  )?.[1]
  if (!allowed) return [`${path}: undeclared GraphQL module`]
  return typescriptModuleSpecifiers(path, source).flatMap((specifier) => {
    const identity = resolveImport(path, specifier)
    return allowed.includes(identity) ? [] : [`${path}: forbidden GraphQL dependency ${specifier}`]
  })
}

export const graphQLImportViolations = (sources: readonly GraphQLSource[]) =>
  [
    ...sources.flatMap(sourceViolations),
    ...findDependencyCycles(
      sources,
      ({ path }) => path.replace(/\.ts$/, '.js'),
      ({ path, source }) =>
        typescriptModuleSpecifiers(path, source).map((specifier) => resolveImport(path, specifier)),
    ).map((cycle) => `GraphQL dependency cycle: ${cycle}`),
  ].toSorted((left, right) => left.localeCompare(right))
