import {
  getArgumentValues,
  getDirectiveValues,
  getNamedType,
  getNullableType,
  getOperationAST,
  getVariableValues,
  GraphQLError,
  GraphQLIncludeDirective,
  GraphQLSkipDirective,
  isObjectType,
  isEnumType,
  isInputObjectType,
  isListType,
  Kind,
  parse,
  validate,
  visit,
  TypeNameMetaFieldDef,
  SchemaMetaFieldDef,
  TypeMetaFieldDef,
  type GraphQLSchema,
  type GraphQLObjectType,
  type SelectionNode,
  type FragmentDefinitionNode,
  type FieldNode,
} from 'graphql'
import { isPositiveSafeInteger } from '../type-guards.js'

type GraphQLValues = ReturnType<typeof getArgumentValues>

export interface GraphQLFieldPolicy {
  readonly field: string
  readonly protected: boolean
  readonly cost: number
  readonly sourceCost: number
  readonly projection?: boolean
  readonly list?: {
    readonly argument?: string
    readonly defaultSize: number
    readonly maximum: number
  }
}

interface SelectionFrame {
  readonly selections: readonly SelectionNode[]
  readonly type: GraphQLObjectType
  readonly depth: number
  readonly multiplier: number
}

export interface GraphQLSelectionVerdict {
  readonly private: boolean
  readonly cost: number
  readonly rows: number
}

const rejectOperation = (): never => {
  throw new GraphQLError('Invalid or excessive read operation.', {
    extensions: { code: 'BAD_USER_INPUT' },
  })
}

const selected = (node: SelectionNode, variables: GraphQLValues) =>
  getDirectiveValues(GraphQLSkipDirective, node, variables)?.if !== true &&
  getDirectiveValues(GraphQLIncludeDirective, node, variables)?.if !== false

const listSize = (policy: GraphQLFieldPolicy, args: GraphQLValues) => {
  if (!policy.list) return 1
  const value = policy.list.argument
    ? (args[policy.list.argument] ?? policy.list.defaultSize)
    : policy.list.maximum
  const size = Array.isArray(value) ? value.length : value
  if (!isPositiveSafeInteger(size) || size > policy.list.maximum) return rejectOperation()
  return size
}

const fragmentFrame = (
  node: SelectionNode,
  frame: SelectionFrame,
  fragments: Map<string, FragmentDefinitionNode>,
): SelectionFrame | null => {
  if (node.kind === Kind.INLINE_FRAGMENT)
    return { ...frame, selections: node.selectionSet.selections }
  if (node.kind !== Kind.FRAGMENT_SPREAD) return null
  const fragment = fragments.get(node.name.value)
  return fragment ? { ...frame, selections: fragment.selectionSet.selections } : null
}

interface SelectionTotals {
  fields: number
  aliases: number
  bindings: number
  rows: number
  cost: number
  private: boolean
  introspectionCost: number
}

const fieldDefinition = (frame: SelectionFrame, node: FieldNode) => {
  if (node.name.value === '__typename') return TypeNameMetaFieldDef
  if (node.name.value === '__schema') return SchemaMetaFieldDef
  if (node.name.value === '__type') return TypeMetaFieldDef
  return frame.type.getFields()[node.name.value]
}

const accountFieldSelection = (
  node: FieldNode,
  policy: GraphQLFieldPolicy | undefined,
  totals: SelectionTotals,
) => {
  if (node.directives?.some(({ name }) => name.value === 'defer' || name.value === 'stream'))
    return rejectOperation()
  if (node.alias && ++totals.aliases > 30) return rejectOperation()
  if (node.name.value.startsWith('__') || policy?.protected) totals.private = true
  if (policy && !policy.projection && ++totals.bindings > 12) return rejectOperation()
}

const accountFieldCost = (
  frame: SelectionFrame,
  policy: GraphQLFieldPolicy | undefined,
  size: number,
  totals: SelectionTotals,
) => {
  if (frame.type.name.startsWith('__')) {
    totals.introspectionCost += frame.multiplier * size
    if (totals.introspectionCost > 1_000_000) return rejectOperation()
    return
  }
  if (policy?.list) totals.rows += size * frame.multiplier
  totals.cost += frame.multiplier * (policy ? policy.cost * size + policy.sourceCost : 1)
  if (totals.rows > 1000 || totals.cost > 5000) return rejectOperation()
}

const childSelectionFrame = (
  node: FieldNode,
  frame: SelectionFrame,
  field: ReturnType<typeof fieldDefinition>,
  size: number,
): SelectionFrame | null => {
  if (!node.selectionSet || !field) return null
  const childType = getNamedType(field.type)
  if (!isObjectType(childType)) return null
  return {
    selections: node.selectionSet.selections,
    type: childType,
    depth: frame.depth + 1,
    multiplier: frame.multiplier * (isListType(getNullableType(field.type)) ? size : 1),
  }
}

const introspectionListBound = (schema: GraphQLSchema, name: string): number => {
  const types = Object.values(schema.getTypeMap())
  if (name === 'types' || name === 'possibleTypes' || name === 'interfaces') return types.length
  if (name === 'directives') return schema.getDirectives().length
  if (name === 'enumValues')
    return Math.max(1, ...types.filter(isEnumType).map((type) => type.getValues().length))
  if (name === 'inputFields')
    return Math.max(
      1,
      ...types.filter(isInputObjectType).map((type) => Object.keys(type.getFields()).length),
    )
  if (name === 'args')
    return Math.max(
      1,
      ...schema.getDirectives().map((directive) => directive.args.length),
      ...types
        .filter(isObjectType)
        .flatMap((type) => Object.values(type.getFields()).map((field) => field.args.length)),
    )
  if (name === 'locations') return 19
  return Math.max(
    1,
    ...types.filter(isObjectType).map((type) => Object.keys(type.getFields()).length),
  )
}

const inspectField = (
  node: FieldNode,
  frame: SelectionFrame,
  variables: GraphQLValues,
  policies: Map<string, GraphQLFieldPolicy>,
  totals: SelectionTotals,
  schema: GraphQLSchema,
): SelectionFrame | null => {
  const field = fieldDefinition(frame, node)
  const policy = policies.get(`${frame.type.name}.${node.name.value}`)
  accountFieldSelection(node, policy, totals)
  let size = policy && field ? listSize(policy, getArgumentValues(field, node, variables)) : 1
  if (field && isListType(getNullableType(field.type)) && !policy) {
    if (!frame.type.name.startsWith('__')) return rejectOperation()
    size = introspectionListBound(schema, node.name.value)
  }
  accountFieldCost(frame, policy, size, totals)
  return childSelectionFrame(node, frame, field, size)
}

const inspectFrame = (
  frame: SelectionFrame,
  variables: GraphQLValues,
  fragments: Map<string, FragmentDefinitionNode>,
  policies: Map<string, GraphQLFieldPolicy>,
  totals: SelectionTotals,
  schema: GraphQLSchema,
) => {
  const maximumDepth = frame.type.name.startsWith('__') ? 16 : 10
  if (frame.depth > maximumDepth) return rejectOperation()
  const next: SelectionFrame[] = []
  for (const node of frame.selections) {
    if (!selected(node, variables)) continue
    if (++totals.fields > 500) return rejectOperation()
    const fragment = fragmentFrame(node, frame, fragments)
    if (fragment) {
      next.push(fragment)
      continue
    }
    if (node.kind !== Kind.FIELD) continue
    const child = inspectField(node, frame, variables, policies, totals, schema)
    if (child) next.push(child)
  }
  return next
}

const prepareOperation = (
  schema: GraphQLSchema,
  query: string,
  operationName: string | undefined,
  inputVariables: GraphQLValues,
) => {
  if (Buffer.byteLength(query, 'utf8') > 16_384) return rejectOperation()
  const document = parse(query, { maxTokens: 2000 })
  visit(document, {
    Directive: (node) => {
      if (node.name.value === 'defer' || node.name.value === 'stream') rejectOperation()
    },
  })
  if (validate(schema, document, undefined, { maxErrors: 20 }).length) return rejectOperation()
  const operation = getOperationAST(document, operationName)
  if (operation?.operation !== 'query') return rejectOperation()
  const variableResult = getVariableValues(
    schema,
    operation.variableDefinitions ?? [],
    inputVariables,
    { maxErrors: 20 },
  )
  if (variableResult.errors) return rejectOperation()
  const root = schema.getQueryType()
  if (!root) return rejectOperation()
  const fragments = new Map(
    document.definitions.flatMap((node) =>
      node.kind === Kind.FRAGMENT_DEFINITION ? [[node.name.value, node] as const] : [],
    ),
  )
  return { document, operation, variables: variableResult.coerced, root, fragments }
}

export const analyzeGraphQLSelection = (
  schema: GraphQLSchema,
  query: string,
  operationName: string | undefined,
  inputVariables: GraphQLValues,
  policies: readonly GraphQLFieldPolicy[],
): GraphQLSelectionVerdict => {
  const { document, operation, variables, root, fragments } = prepareOperation(
    schema,
    query,
    operationName,
    inputVariables,
  )
  const policyByField = new Map(policies.map((policy) => [policy.field, policy]))
  const frames: SelectionFrame[] = [
    { selections: operation.selectionSet.selections, type: root, depth: 1, multiplier: 1 },
  ]
  const totals: SelectionTotals = {
    fields: 0,
    aliases: 0,
    bindings: 0,
    rows: 0,
    cost: 0,
    private: false,
    introspectionCost: 0,
  }
  // Skipped protected selections remain non-storeable; overclassification is safe.
  visit(document, {
    Field: (node) => {
      if (
        node.name.value.startsWith('__') ||
        policies.some((policy) => policy.protected && policy.field.endsWith(`.${node.name.value}`))
      )
        totals.private = true
    },
  })
  if (
    operation.selectionSet.selections.some(
      (node) => node.kind === Kind.FIELD && !policyByField.has(`${root.name}.${node.name.value}`),
    )
  )
    totals.private = true
  while (frames.length)
    frames.push(...inspectFrame(frames.pop()!, variables, fragments, policyByField, totals, schema))
  return { private: totals.private, cost: totals.cost, rows: totals.rows }
}
