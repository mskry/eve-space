import { createHash } from 'node:crypto'
import { codegen } from '@graphql-codegen/core'
import * as typescript from '@graphql-codegen/typescript'
import * as operations from '@graphql-codegen/typescript-operations'
import * as documents from '@graphql-codegen/typed-document-node'
import {
  buildASTSchema,
  Kind,
  lexicographicSortSchema,
  parse,
  printSchema,
  validate,
  type DefinitionNode,
} from 'graphql'
import { coreCharacterTypeDefs } from '../api/src/graphql/core-character-types.js'
import { applicationGraphQLScalars } from './graphql-scalars.js'

export const graphqlArtifactPaths = {
  sdl: 'api/src/generated/graphql/application.graphql',
  schema: 'app/generated/graphql-schema.ts',
  operations: 'app/generated/graphql-operations.ts',
} as const

export const generateGraphQLArtifacts = async (installedSDL: string, operationSource: string) => {
  const installed = parse(installedSDL)
  const core = parse(coreCharacterTypeDefs)
  const coreObjects = core.definitions.filter(
    (definition) =>
      definition.kind === Kind.OBJECT_TYPE_DEFINITION ||
      definition.kind === Kind.OBJECT_TYPE_EXTENSION,
  )
  const definitions = installed.definitions.flatMap<DefinitionNode>((definition) => {
    if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION) return [definition]
    const override = coreObjects.find((item) => item.name.value === definition.name.value)
    if (!override) return [definition]
    if (override.kind === Kind.OBJECT_TYPE_DEFINITION && override.name.value !== 'Query') return []
    const fields = definition.fields?.filter(
      (field) => !override.fields?.some((item) => item.name.value === field.name.value),
    )
    if (override.kind === Kind.OBJECT_TYPE_DEFINITION && !fields?.length) return []
    return [
      {
        ...definition,
        kind:
          override.kind === Kind.OBJECT_TYPE_DEFINITION
            ? Kind.OBJECT_TYPE_EXTENSION
            : Kind.OBJECT_TYPE_DEFINITION,
        fields,
      },
    ]
  })
  const schema = lexicographicSortSchema(
    buildASTSchema({
      kind: Kind.DOCUMENT,
      definitions: [...definitions, ...core.definitions],
    }),
  )
  const document = parse(operationSource)
  const errors = validate(schema, document)
  if (errors.length) throw new Error(errors.map((error) => error.message).join('\n'))
  const sdl = `${printSchema(schema)}\n`
  const fingerprint = createHash('sha256').update(sdl).digest('hex')
  const generated = await codegen({
    filename: graphqlArtifactPaths.operations,
    schema: parse(sdl),
    documents: [{ document }],
    plugins: [{ typescript: {} }, { operations: {} }, { documents: {} }],
    pluginMap: { typescript, operations, documents },
    config: {
      scalars: applicationGraphQLScalars,
      strictScalars: true,
      documentMode: 'string',
      useTypeImports: true,
      immutableTypes: true,
      enumsAsTypes: true,
      skipTypename: true,
      avoidOptionals: true,
    },
  })
  return new Map([
    [graphqlArtifactPaths.sdl, sdl],
    [
      graphqlArtifactPaths.schema,
      `export const graphqlSchemaFingerprint = ${JSON.stringify(fingerprint)}\n`,
    ],
    [graphqlArtifactPaths.operations, generated],
  ])
}
