import { createHash } from 'node:crypto'
import { codegen } from '@graphql-codegen/core'
import * as operations from '@graphql-codegen/typescript-operations'
import {
  buildSchema,
  Kind,
  parse,
  print,
  separateOperations,
  validate,
  type DocumentNode,
} from 'graphql'
import { applicationGraphQLScalars } from './graphql-scalars.js'

const typedOperationStrings = (document: DocumentNode) =>
  Object.entries(separateOperations(document))
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, selection]) => {
      const query = JSON.stringify(print(selection))
      const justification =
        '// SAFETY: schema validation and code generation derive this document and its result/variables from the same operation.'
      return `${justification}\nexport const ${name}Document = ${query} as string & GraphQLDocument<${name}Query, ${name}QueryVariables>`
    })
    .join('\n')

export const generateFeatureGraphQL = async (sdl: string, source: string) => {
  const schema = buildSchema(sdl)
  const document = parse(source)
  const errors = validate(schema, document)
  if (errors.length) throw new Error(errors.map((error) => error.message).join('\n'))
  const selections = document.definitions.filter(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  )
  if (
    !selections.length ||
    selections.some((selection) => !selection.name || selection.operation !== 'query')
  )
    throw new Error('Feature GraphQL operations must be named queries.')
  const generated = await codegen({
    filename: 'market-graphql.ts',
    schema: parse(sdl),
    documents: [{ document }],
    plugins: [{ operations: {} }],
    pluginMap: { operations },
    config: {
      scalars: applicationGraphQLScalars,
      strictScalars: true,
      documentMode: 'string',
      onlyOperationTypes: true,
      preResolveTypes: true,
      useTypeImports: true,
      immutableTypes: true,
      enumsAsTypes: true,
      skipTypename: true,
      avoidOptionals: true,
    },
  })
  const schemaIdentity = createHash('sha256').update(sdl).digest('hex')
  const operationIdentity = createHash('sha256').update(source).digest('hex')
  const identity = JSON.stringify([schemaIdentity, operationIdentity])
  return `import type { GraphQLDocument } from '@eve-space/platform-module-nuxt/runtime'\nexport const marketGraphQLIdentity = ${identity} as const\n${generated}\n${typedOperationStrings(document)}\n`
}
