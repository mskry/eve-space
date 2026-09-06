import { resolve } from 'node:path'

import { $, createClient, type OpenApi, type Plugins, type UserConfig } from '@hey-api/openapi-ts'

export interface HeyApiGenerationOptions {
  readonly input: string | Readonly<Record<string, unknown>>
  readonly outputDirectory: string
}

const int64NumberMarker = 'x-eve-int64-number'
const noContentMarker = 'x-eve-no-content'
const oneOfMarker = 'x-eve-one-of'
const uniqueItemsMarker = 'x-eve-unique-items'

const typeScriptResolvers = {
  string(context) {
    if (context.schema[noContentMarker] === true) return $.type('undefined')
    return undefined
  },
  object(context) {
    const path = context.path['~ref']
    const isOperationContainer =
      path.length === 5 &&
      path[0] === 'paths' &&
      typeof path[1] === 'string' &&
      typeof path[2] === 'string' &&
      typeof path[3] === 'string' &&
      (path[4] === 'data' || path[4] === 'responses')
    if (!isOperationContainer && context.schema.additionalProperties === undefined) {
      return context.nodes
        .shape(context)
        .idxSig('key', (signature) => signature.key('string').type('unknown'))
    }
    return context.nodes.base(context)
  },
} satisfies Plugins.HeyApiTypeScript.Resolvers

const zodResolvers = {
  array(context) {
    context.chain.current = context.nodes.base(context)
    const length = context.nodes.length(context)
    if (length) {
      context.chain.current = length
    } else {
      const minimum = context.nodes.minLength(context)
      if (minimum) context.chain.current = minimum
      const maximum = context.nodes.maxLength(context)
      if (maximum) context.chain.current = maximum
    }
    if (context.schema[uniqueItemsMarker] === true) {
      const canonicalize = createCanonicalJsonFunction()
      const isUnique = $.func()
        .param('items')
        .do(
          $.return(
            $.new('Set', $('items').attr('map').call(canonicalize))
              .attr('size')
              .eq($('items').attr('length')),
          ),
        )
      context.chain.current = context.chain.current
        .attr('refine')
        .call(isUnique, $.object().prop('message', $.literal('Array items must be unique')))
    }
    return context.chain.current
  },
  number(context) {
    if (context.schema.type !== 'integer' || context.schema[int64NumberMarker] !== true) {
      return undefined
    }
    const { schema } = context
    const { z } = context.plugin.imports
    let chain = $(z).attr('int').call()
    if (schema.exclusiveMinimum !== undefined) {
      chain = chain.attr('gt').call($.literal(schema.exclusiveMinimum))
    } else if (schema.minimum !== undefined) {
      chain = chain.attr('gte').call($.literal(schema.minimum))
    }
    if (schema.exclusiveMaximum !== undefined) {
      chain = chain.attr('lt').call($.literal(schema.exclusiveMaximum))
    } else if (schema.maximum !== undefined) {
      chain = chain.attr('lte').call($.literal(schema.maximum))
    }
    return chain
  },
  string(context) {
    if (context.schema[noContentMarker] !== true) return undefined
    const { z } = context.plugin.imports
    return $(z).attr('undefined').call()
  },
  object(context) {
    const { z } = context.plugin.imports
    const additional = context.nodes.additionalProperties(context)
    let chain = $(z).attr('looseObject').call(context.nodes.shape(context))
    if (additional) chain = chain.attr('catchall').call(additional)
    return chain
  },
  union(context) {
    if (context.schemas.some((schema) => schema[noContentMarker] === true)) {
      const { z } = context.plugin.imports
      return $(z)
        .attr('union')
        .call(
          $.array()
            .pretty()
            .elements(...context.childResults.map(({ chain }) => chain)),
        )
    }
    if (context.parentSchema[oneOfMarker] !== true) return undefined
    if (context.childResults.length === 1) return context.childResults[0]?.chain
    const { z } = context.plugin.imports
    return $(z)
      .attr('xor')
      .call(
        $.array()
          .pretty()
          .elements(...context.childResults.map(({ chain }) => chain)),
      )
  },
} satisfies Plugins.Zod.Resolvers

export function createHeyApiGenerationConfig({
  input,
  outputDirectory,
}: HeyApiGenerationOptions): UserConfig {
  return {
    input: typeof input === 'string' ? input : cloneDocument(input),
    interactive: false,
    logs: { file: false, level: 'silent' },
    parser: { patch: { input: preserveResolverSemantics } },
    output: {
      clean: true,
      entryFile: true,
      module: { extension: '.js' },
      path: resolve(outputDirectory),
      postProcess: [],
      source: false,
      tsConfigPath: null,
    },
    plugins: [
      {
        name: '@hey-api/typescript',
        definitions: { name: '{{name}}' },
        requests: { name: '{{name}}Data' },
        responses: { name: '{{name}}Responses', response: '{{name}}Response' },
        $resolvers: typeScriptResolvers,
      },
      {
        name: 'zod',
        compatibilityVersion: 4,
        dates: { offset: true },
        definitions: { enabled: true },
        requests: {
          enabled: true,
          body: { enabled: true },
          headers: { enabled: true },
          path: { enabled: true },
          query: { enabled: true },
        },
        responses: { enabled: true },
        $resolvers: zodResolvers,
      },
    ],
  }
}

export async function generateHeyApiArtifacts(options: HeyApiGenerationOptions): Promise<void> {
  const contexts = await createClient(createHeyApiGenerationConfig(options))
  if (contexts.length !== 1) {
    throw new Error(`Hey API generation produced ${contexts.length} generation contexts`)
  }
}

function preserveResolverSemantics(
  document: OpenApi.V2_0_X | OpenApi.V3_0_X | OpenApi.V3_1_X,
): void {
  projectOperationParameters(document)
  markNoContentResponses(document)
  visitOpenApiValue(document)
}

function projectOperationParameters(document: unknown): void {
  if (!isRecord(document)) return
  const componentParameters = isRecord(document.components)
    ? document.components.parameters
    : undefined
  if (!isRecord(document.paths)) return
  for (const pathItem of Object.values(document.paths)) {
    if (!isRecord(pathItem)) continue
    projectParameterList(pathItem, componentParameters)
    for (const method of ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']) {
      const operation = pathItem[method]
      if (isRecord(operation)) projectParameterList(operation, componentParameters)
    }
  }
}

function projectParameterList(owner: Record<string, unknown>, componentParameters: unknown): void {
  if (!Array.isArray(owner.parameters)) return
  owner.parameters = owner.parameters.filter((parameter) => {
    const resolved = resolveParameter(parameter, componentParameters)
    return !(
      isRecord(resolved) &&
      resolved.in === 'header' &&
      (resolved.name === 'Accept-Language' || resolved.name === 'X-Compatibility-Date')
    )
  })
}

function resolveParameter(parameter: unknown, componentParameters: unknown): unknown {
  if (!isRecord(parameter) || typeof parameter.$ref !== 'string') return parameter
  const match = /^#\/components\/parameters\/([^/]+)$/u.exec(parameter.$ref)
  if (match === null || !isRecord(componentParameters)) return parameter
  return componentParameters[match[1] ?? '']
}

function markNoContentResponses(document: unknown): void {
  if (!isRecord(document) || !isRecord(document.paths)) return
  for (const pathItem of Object.values(document.paths)) {
    if (!isRecord(pathItem)) continue
    for (const method of ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']) {
      const operation = pathItem[method]
      if (!isRecord(operation) || !isRecord(operation.responses)) continue
      for (const status of ['204', '205']) {
        const response = operation.responses[status]
        if (!isRecord(response) || response.content !== undefined) continue
        // A non-null sentinel avoids Hey's nullable-union optimization; both resolvers emit undefined.
        response.content = {
          'application/json': { schema: { [noContentMarker]: true, type: 'string' } },
        }
      }
    }
  }
}

function visitOpenApiValue(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) visitOpenApiValue(item)
    return
  }
  if (!isRecord(value)) return
  if (value.type === 'integer' && value.format === 'int64') {
    value[int64NumberMarker] = true
    delete value.format
  }
  if (value.uniqueItems === true) value[uniqueItemsMarker] = true
  if (Array.isArray(value.oneOf)) value[oneOfMarker] = true
  for (const child of Object.values(value)) visitOpenApiValue(child)
}

function createCanonicalJsonFunction() {
  const isPrimitiveOrArray = $.binary(
    $.binary(
      $.binary($('current'), '===', $.literal(null)),
      '||',
      $.binary($.typeofExpr($('current')), '!==', $.literal('object')),
    ),
    '||',
    $('Array').attr('isArray').call('current'),
  )
  const compareKeys = $.func()
    .param('left')
    .param('right')
    .do(
      $.return(
        $.ternary($.binary($('left').attr(0), '<', $('right').attr(0)))
          .do($.literal(-1))
          .otherwise(
            $.ternary($.binary($('left').attr(0), '>', $('right').attr(0)))
              .do($.literal(1))
              .otherwise($.literal(0)),
          ),
      ),
    )
  const replacer = $.func()
    .param('_key', (parameter) => parameter.type('string'))
    .param('current', (parameter) => parameter.type('unknown'))
    .do(
      $.return(
        $.ternary(isPrimitiveOrArray)
          .do('current')
          .otherwise(
            $('Object')
              .attr('fromEntries')
              .call($('Object').attr('entries').call('current').attr('sort').call(compareKeys)),
          ),
      ),
    )
  return $.func()
    .param('value', (parameter) => parameter.type('unknown'))
    .do($.return($('JSON').attr('stringify').call('value', replacer)))
}

function cloneDocument(document: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const clone: unknown = structuredClone(document)
  if (!isRecord(clone)) throw new TypeError('Hey API input must be an in-memory document object')
  return clone
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
