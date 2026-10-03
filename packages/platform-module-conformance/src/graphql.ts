import {
  buildASTSchema,
  Kind,
  lexicographicSortSchema,
  parse,
  printSchema,
  validateSchema,
  getNullableType,
  isListType,
  isObjectType,
  type DefinitionNode,
  type FieldDefinitionNode,
  type TypeNode,
  type InputValueDefinitionNode,
  type DocumentNode,
  type GraphQLArgument,
  type GraphQLSchema,
} from 'graphql'
import type {
  PlatformGraphQLContribution,
  PlatformGraphQLDefinition,
  PlatformGraphQLReadDeclaration,
} from '@eve-space/platform-module-contract/graphql'

export const graphqlCoreScalarTypeDefs = `
  scalar EveId
  scalar Decimal
  scalar BigInteger
  scalar UUID
  scalar UTCTime
  scalar UTCDate
`

export const graphqlCoreTypeDefs = `
  ${graphqlCoreScalarTypeDefs}
  type Query { ownedCharacters(first: Int, after: String): OwnedCharacterConnection, ownedCharacter(characterId: EveId!): OwnedCharacter }
  type OwnedCharacterConnection { nodes: [OwnedCharacter!]! }
  type OwnedCharacter { characterId: EveId! }
`

const scalarNames = new Set([
  'String',
  'Int',
  'Float',
  'Boolean',
  'ID',
  'EveId',
  'Decimal',
  'BigInteger',
  'UUID',
  'UTCTime',
  'UTCDate',
])

export interface GraphQLSchemaContribution extends PlatformGraphQLContribution {
  readonly definition: PlatformGraphQLDefinition
}

const namedType = (type: TypeNode): string => {
  if (type.kind === Kind.NAMED_TYPE) return type.name.value
  return namedType(type.type)
}

const listType = (type: TypeNode): boolean => {
  if (type.kind === Kind.NON_NULL_TYPE) return listType(type.type)
  return type.kind === Kind.LIST_TYPE
}

const validateListArgument = (
  field: FieldDefinitionNode,
  binding: PlatformGraphQLReadDeclaration,
) => {
  if (!binding.list?.argument) return
  const argument = field.arguments?.find(({ name }) => name.value === binding.list!.argument)
  if (!argument || (namedType(argument.type) !== 'Int' && !listType(argument.type)))
    throw new Error(`Invalid GraphQL list argument ${binding.field}`)
}

const defaultListSize = (argument: GraphQLArgument): number | undefined => {
  if (isListType(getNullableType(argument.type))) {
    if (Array.isArray(argument.defaultValue)) return argument.defaultValue.length
    return undefined
  }
  if (typeof argument.defaultValue === 'number') return argument.defaultValue
  return undefined
}

const validateListDefault = (schema: GraphQLSchema, read: PlatformGraphQLReadDeclaration) => {
  if (!read.list?.argument) return
  const [type, field] = read.field.split('.')
  const owner = schema.getType(type!)
  if (!isObjectType(owner)) throw new Error(`Non-executable GraphQL field ${read.field}`)
  const argument = owner.getFields()[field!]!.args.find(({ name }) => name === read.list!.argument)
  if (argument?.astNode?.defaultValue && defaultListSize(argument) !== read.list.defaultSize)
    throw new Error(`GraphQL list default mismatch ${read.field}`)
}

const validateSubjectArgument = (
  field: FieldDefinitionNode,
  binding: PlatformGraphQLReadDeclaration,
) => {
  if (!binding.subjectArgument) return
  const argument = field.arguments?.find(({ name }) => name.value === binding.subjectArgument)
  if (binding.strategy === 'personal-inventory') {
    if (
      argument?.type.kind !== Kind.LIST_TYPE ||
      argument.type.type.kind !== Kind.NON_NULL_TYPE ||
      namedType(argument.type) !== 'EveId'
    )
      throw new Error(`Invalid GraphQL personal selection argument ${binding.field}`)
    return
  }
  if (
    argument?.type.kind !== Kind.NON_NULL_TYPE ||
    argument.type.type.kind !== Kind.NAMED_TYPE ||
    namedType(argument.type) !== 'EveId'
  )
    throw new Error(`Invalid GraphQL subject argument ${binding.field}`)
}

const validateField = (
  field: FieldDefinitionNode,
  owner: string,
  contribution: GraphQLSchemaContribution,
) => {
  if (field.directives?.length) throw new Error('GraphQL contribution directives are unsupported')
  const binding = contribution.reads.find((read) => read.field === `${owner}.${field.name.value}`)
  if (listType(field.type) && !binding?.list)
    throw new Error(`Unbounded GraphQL list ${owner}.${field.name.value}`)
  if (!binding) return
  validateListArgument(field, binding)
  validateSubjectArgument(field, binding)
}

const validateDefinitionKind = (
  definition: DefinitionNode,
  contribution: GraphQLSchemaContribution,
) => {
  if (definition.kind === Kind.OBJECT_TYPE_EXTENSION && definition.name.value === 'Query') {
    if (
      definition.fields?.length !== 1 ||
      definition.fields[0]?.name.value !== contribution.rootField ||
      definition.fields[0].type.kind === Kind.NON_NULL_TYPE
    )
      throw new Error('GraphQL nullable root inventory mismatch')
  } else if (
    definition.kind === Kind.OBJECT_TYPE_DEFINITION ||
    definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ||
    definition.kind === Kind.ENUM_TYPE_DEFINITION
  ) {
    if (!contribution.types.includes(definition.name.value))
      throw new Error(`Undeclared GraphQL type ${definition.name.value}`)
  } else throw new Error('Unsupported GraphQL contribution definition')
}

const validateReferences = (
  field: FieldDefinitionNode | InputValueDefinitionNode,
  contribution: GraphQLSchemaContribution,
) => {
  const references = [
    field.type,
    ...('arguments' in field ? (field.arguments ?? []).map(({ type }) => type) : []),
  ]
  for (const type of references) {
    if (!scalarNames.has(namedType(type)) && !contribution.types.includes(namedType(type)))
      throw new Error(`Cross-owner GraphQL type ${namedType(type)}`)
  }
}

const validateDefinition = (
  definition: DefinitionNode,
  contribution: GraphQLSchemaContribution,
) => {
  validateDefinitionKind(definition, contribution)
  if (!('name' in definition) || !definition.name || !('directives' in definition))
    throw new Error('Unsupported GraphQL contribution definition')
  if (definition.directives?.length)
    throw new Error('GraphQL contribution directives are unsupported')
  if (!('fields' in definition)) return
  for (const field of definition.fields ?? []) {
    validateReferences(field, contribution)
    if (field.kind === Kind.FIELD_DEFINITION)
      validateField(field, definition.name.value, contribution)
  }
}

const validateReadField = (
  document: DocumentNode,
  contribution: GraphQLSchemaContribution,
  read: PlatformGraphQLReadDeclaration,
) => {
  const [type, field] = read.field.split('.')
  const definition = document.definitions.find(
    (node) => 'name' in node && node.name?.value === type,
  )
  if (
    definition &&
    definition.kind !== Kind.OBJECT_TYPE_DEFINITION &&
    definition.kind !== Kind.OBJECT_TYPE_EXTENSION
  )
    throw new Error(`Non-executable GraphQL field ${read.field}`)
  if (
    !definition ||
    !('fields' in definition) ||
    !definition.fields?.some(({ name }) => name.value === field)
  )
    throw new Error(`Missing GraphQL field ${read.field}`)
  if (typeof contribution.definition.reads[read.field] !== 'function')
    throw new Error(`Invalid GraphQL resolver ${read.field}`)
}

export const validateContributionSchema = (contribution: GraphQLSchemaContribution) => {
  if (Object.keys(contribution.definition).some((key) => key !== 'typeDefs' && key !== 'reads'))
    throw new Error('Extra GraphQL definition export')
  const document = parse(contribution.definition.typeDefs, { maxTokens: 4_000 })
  for (const definition of document.definitions) validateDefinition(definition, contribution)
  const declaredTypes = document.definitions.flatMap((definition) =>
    'name' in definition && definition.name?.value !== 'Query' ? [definition.name!.value] : [],
  )
  if (
    new Set(declaredTypes).size !== contribution.types.length ||
    declaredTypes.length !== contribution.types.length
  )
    throw new Error('GraphQL type inventory mismatch')
  const declaredReads = contribution.reads
    .map(({ field }) => field)
    .toSorted((left, right) => left.localeCompare(right))
  const executableReads = Object.keys(contribution.definition.reads).toSorted((left, right) =>
    left.localeCompare(right),
  )
  if (JSON.stringify(declaredReads) !== JSON.stringify(executableReads))
    throw new Error('GraphQL executable read inventory mismatch')
  for (const read of contribution.reads) validateReadField(document, contribution, read)
  const schema = buildASTSchema({
    kind: Kind.DOCUMENT,
    definitions: [...parse(graphqlCoreTypeDefs).definitions, ...document.definitions],
  })
  for (const read of contribution.reads) validateListDefault(schema, read)
  return document
}

export const composeContributionSDL = (
  contributions: readonly GraphQLSchemaContribution[],
  coreTypeDefs = graphqlCoreTypeDefs,
): string => {
  const definitions = contributions.flatMap(
    (contribution) => validateContributionSchema(contribution).definitions,
  )
  const schema = buildASTSchema({
    kind: Kind.DOCUMENT,
    definitions: [...parse(coreTypeDefs).definitions, ...definitions],
  })
  const issues = validateSchema(schema)
  if (issues.length) throw new Error(issues.map(({ message }) => message).join('\n'))
  return `${printSchema(lexicographicSortSchema(schema))}\n`
}
