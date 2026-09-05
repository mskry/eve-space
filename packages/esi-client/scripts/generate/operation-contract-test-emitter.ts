import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createProvenanceHeader, type ArtifactProvenance } from './artifacts.ts';
import { resolveOperationAuthentication } from './domain-client.ts';
import type {
  NormalizedModel,
  NormalizedOpenApiModel,
  NormalizedOperation,
  NormalizedParameter,
  NormalizedSchema,
} from './normalize.ts';
import { isTransportManagedParameter } from './operation-parameters.ts';
import type { EmitterContext } from './orchestrate.ts';
import { createSchemaContractFixture } from './schema-test-emitter.ts';
import type { GeneratedTestComponent } from './test-emitter.ts';
import { operationSchemaName, operationStatusResponseSchemaName } from './zod-schema.ts';

interface ParameterDescriptor {
  readonly name: string;
  readonly placement: 'path' | 'query' | 'header';
  readonly required: boolean;
  readonly schema: Record<string, unknown>;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
}

interface OperationRequestBodyContract {
  readonly required: boolean;
  readonly mediaType: string;
}

interface OperationResponseContract {
  readonly status: string;
  readonly body: 'json' | 'none';
  readonly schemaExport: string;
}

interface ExpectedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

interface OperationContract {
  readonly operationId: string;
  readonly method: string;
  readonly pathTemplate: string;
  readonly parameters: readonly ParameterDescriptor[];
  readonly authentication: { readonly required: boolean; readonly scopes: readonly string[] };
  readonly requestBody: OperationRequestBodyContract | null;
  readonly requestSchemaExport: string;
  readonly arguments: Record<string, unknown>;
  readonly expectedRequest: ExpectedRequest;
  readonly responses: readonly OperationResponseContract[];
}

export function renderGeneratedOperationContractTests(
  model: NormalizedOpenApiModel,
  provenance: ArtifactProvenance,
): string {
  assertExactOperationAccounting(model);
  const modelsByPointer = new Map(model.models.map((entry) => [entry.pointer, entry]));
  const contracts = [...model.operations]
    .toSorted((left, right) => compareText(left.operationId, right.operationId))
    .map((operation) => createOperationContract(operation, model.models, modelsByPointer));
  if (contracts.length === 0) throw new Error('No operation contracts were generated');
  const responseContracts = contracts.flatMap((contract) =>
    contract.responses.map((response) => ({ operationId: contract.operationId, ...response })),
  );
  const jsonResponseContracts = responseContracts.filter(({ body }) => body === 'json');
  const noContentResponseContracts = responseContracts.filter(({ body }) => body === 'none');

  const body = `import { describe, expect, it } from 'vitest';

import { constructOperationRequest } from '../../src/client/request.js';
import {
  operationManifest,
  operationRegistry,
} from '../../src/generated/operations/index.js';

const operationContracts = ${JSON.stringify(contracts, null, 2)} as const;
const jsonResponseContracts = ${JSON.stringify(jsonResponseContracts, null, 2)} as const;
const noContentResponseContracts = ${JSON.stringify(noContentResponseContracts, null, 2)} as const;

describe('generated operation contracts', () => {
  it('accounts for exactly all ${contracts.length} operations', () => {
    const expectedIds = operationContracts.map(({ operationId }) => operationId);
    expect(new Set(expectedIds).size).toBe(${contracts.length});
    expect(Object.keys(operationRegistry)).toEqual(expectedIds);
    expect(operationManifest.operations.map(({ operationId }) => operationId)).toEqual(expectedIds);
  });

  it.each(operationContracts)('$operationId matches its complete offline contract', (contract) => {
    const runtime = operationRegistry[contract.operationId];
    const manifest = operationManifest.operations.find(
      ({ operationId }) => operationId === contract.operationId,
    );
    if (runtime === undefined || manifest === undefined) {
      throw new Error(\`Missing generated operation contract: \${contract.operationId}\`);
    }

    expect(runtime.transport.operationId).toBe(contract.operationId);
    expect(runtime.transport.method).toBe(contract.method);
    expect(runtime.transport.path).toBe(contract.pathTemplate);
    expect(runtime.transport.parameters).toEqual(contract.parameters);
    expect(runtime.transport.requestBody).toEqual(contract.requestBody);
    expect(runtime.transport.authentication?.scopes ?? []).toEqual(contract.authentication.scopes);
    expect(runtime.transport.authentication !== null).toBe(contract.authentication.required);

    expect(manifest.http).toEqual({ method: contract.method, path: contract.pathTemplate });
    expect(
      manifest.parameters.map(({ name, placement, required }) => ({ name, placement, required })),
    ).toEqual(contract.parameters.map(({ name, placement, required }) => ({
      name,
      placement,
      required,
    })));
    expect(manifest.authentication).toEqual(contract.authentication);
    expect(manifest.requestBody === null).toBe(contract.requestBody === null);
    expect(manifest.requestBody?.required).toBe(contract.requestBody?.required);
    expect(manifest.requestSchema.export).toBe(contract.requestSchemaExport);

    expect(runtime.requestSchema.parse(contract.arguments)).toEqual(contract.arguments);
    expect(constructOperationRequest(runtime.transport, contract.arguments)).toEqual(
      contract.expectedRequest,
    );

    expect(Object.keys(runtime.responseSchemasByStatus)).toEqual(
      contract.responses.map(({ status }) => status),
    );
    expect(manifest.responses.map(({ status, body, schema }) => ({
      status,
      body,
      schemaExport: schema.export,
    }))).toEqual(contract.responses);

    for (const response of contract.responses) {
      const transportResponse = runtime.transport.successResponses.find(
        ({ status }) => String(status) === response.status,
      );
      if (transportResponse === undefined) {
        throw new Error(\`Missing status contract: \${contract.operationId} \${response.status}\`);
      }
      expect(transportResponse.body).toBe(response.body);
    }
  });

  it.each(jsonResponseContracts)(
    '$operationId $status links its status-specific JSON schema',
    ({ operationId, status }) => {
      const runtime = operationRegistry[operationId];
      const schema = runtime?.responseSchemasByStatus[status];
      const response = runtime?.transport.successResponses.find(
        (candidate) => String(candidate.status) === status,
      );
      if (schema === undefined || response?.body !== 'json') {
        throw new Error(\`Missing JSON response contract: \${operationId} \${status}\`);
      }
      expect(response.schema).toBe(schema);
    },
  );

  it.each(noContentResponseContracts)(
    '$operationId $status enforces no-content behavior',
    ({ operationId, status }) => {
      const runtime = operationRegistry[operationId];
      const schema = runtime?.responseSchemasByStatus[status];
      const response = runtime?.transport.successResponses.find(
        (candidate) => String(candidate.status) === status,
      );
      if (runtime === undefined || schema === undefined || response === undefined) {
        throw new Error(\`Missing no-content response contract: \${operationId} \${status}\`);
      }
      expect(response.body).toBe('none');
      expect(schema.parse(undefined)).toBeUndefined();
      expect(schema.safeParse(null).success).toBe(false);
      expect(runtime.responseSchema.parse(undefined)).toBeUndefined();
    },
  );
});
`;
  return `${createProvenanceHeader(provenance, 'typescript')}\n${body}`;
}

export async function emitGeneratedOperationContractTests(
  context: EmitterContext,
  testsDirectory: string,
): Promise<readonly ['operation-contracts.test.ts']> {
  if (!isObject(context) || !isObject(context.normalizedModel)) {
    throw new TypeError('Generated operation contract context must contain a normalized model');
  }
  if (typeof testsDirectory !== 'string' || testsDirectory.length === 0) {
    throw new TypeError('Generated operation contract directory must be a non-empty string');
  }
  await writeFile(
    join(testsDirectory, 'operation-contracts.test.ts'),
    renderGeneratedOperationContractTests(context.normalizedModel, context.provenance),
  );
  return ['operation-contracts.test.ts'];
}

export const generatedOperationContractTestsComponent: GeneratedTestComponent = Object.freeze({
  name: 'operation-contracts',
  emit: emitGeneratedOperationContractTests,
});

function createOperationContract(
  operation: NormalizedOperation,
  models: readonly NormalizedModel[],
  modelsByPointer: Map<string, NormalizedModel>,
): OperationContract {
  const parameters = operation.parameters.filter(
    (parameter) => !isTransportManagedParameter(parameter),
  );
  const { descriptorParameters, fixtureArguments } = createOperationParameters(
    operation,
    parameters,
    models,
    modelsByPointer,
  );
  const requestBody = createOperationRequestBody(operation, models, fixtureArguments);

  const authentication = resolveOperationAuthentication(operation);
  return {
    operationId: operation.operationId,
    method: operation.method,
    pathTemplate: operation.path,
    parameters: descriptorParameters,
    authentication: {
      required: authentication !== null,
      scopes: authentication?.scopes ?? [],
    },
    requestBody,
    requestSchemaExport: `${operationSchemaName(operation.operationId)}RequestSchema`,
    arguments: fixtureArguments,
    expectedRequest: constructExpectedRequest(
      operation,
      descriptorParameters,
      fixtureArguments,
      requestBody,
    ),
    responses: operation.successResponses.map((response) => ({
      status: response.status,
      body: response.noContent ? ('none' as const) : ('json' as const),
      schemaExport: operationStatusResponseSchemaName(operation.operationId, response.status),
    })),
  };
}

function createOperationParameters(
  operation: NormalizedOperation,
  parameters: readonly NormalizedParameter[],
  models: readonly NormalizedModel[],
  modelsByPointer: Map<string, NormalizedModel>,
): {
  descriptorParameters: ParameterDescriptor[];
  fixtureArguments: Record<string, unknown>;
} {
  const descriptorParameters: ParameterDescriptor[] = [];
  const fixtureArguments: Record<string, unknown> = {};
  for (const parameter of parameters) {
    const contract = createOperationParameterContract(
      operation,
      parameter,
      models,
      modelsByPointer,
    );
    descriptorParameters.push(contract.descriptor);
    if (!contract.hasFixture) continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixtureArguments groups by placement are always plain records
    const group = (fixtureArguments[parameter.placement] ?? {}) as Record<string, unknown>;
    group[parameter.name] = contract.fixture;
    fixtureArguments[parameter.placement] = group;
  }
  return { descriptorParameters, fixtureArguments };
}

function createOperationParameterContract(
  operation: NormalizedOperation,
  parameter: NormalizedParameter,
  models: readonly NormalizedModel[],
  modelsByPointer: Map<string, NormalizedModel>,
): { descriptor: ParameterDescriptor; fixture?: unknown; hasFixture: boolean } {
  try {
    const descriptor = createParameterDescriptor(parameter, modelsByPointer, operation.operationId);
    const fixture = createSchemaContractFixture(parameter.schema, models, {
      nonEmptyStrings: parameter.placement === 'path' || parameter.placement === 'header',
      populate: true,
      preferNonNull: true,
    });
    return { descriptor, fixture, hasFixture: true };
  } catch (cause) {
    if (parameter.required) {
      throw new Error(
        `Unsupported required parameter fixture ${operation.operationId}:${parameter.placement}:${parameter.name}`,
        { cause },
      );
    }
    return {
      descriptor: createParameterDescriptor(parameter, modelsByPointer, operation.operationId),
      hasFixture: false,
    };
  }
}

function createOperationRequestBody(
  operation: NormalizedOperation,
  models: readonly NormalizedModel[],
  fixtureArguments: Record<string, unknown>,
): OperationRequestBodyContract | null {
  if (operation.requestBody === null) return null;
  const requestBody: OperationRequestBodyContract = {
    required: operation.requestBody.required,
    mediaType: 'application/json',
  };
  const content = selectJsonContent(operation.requestBody.content);
  if (content === null) {
    if (operation.requestBody.required) {
      throw new Error(
        `Unsupported required request body fixture ${operation.operationId}: no JSON schema`,
      );
    }
    return requestBody;
  }
  try {
    fixtureArguments.body = createSchemaContractFixture(content.schema, models, {
      nonEmptyStrings: true,
      preferNonNull: true,
    });
  } catch (cause) {
    if (operation.requestBody.required) {
      throw new Error(`Unsupported required request body fixture ${operation.operationId}`, {
        cause,
      });
    }
  }
  return requestBody;
}

function createParameterDescriptor(
  parameter: NormalizedParameter,
  modelsByPointer: Map<string, NormalizedModel>,
  operationId: string,
): ParameterDescriptor {
  if (parameter.placement === 'cookie') {
    throw new Error(`Unsupported parameter placement ${operationId}:${parameter.name}:cookie`);
  }
  const schema = simplifyParameterSchema(
    resolveParameterSchema(parameter.schema, modelsByPointer, new Set(), operationId),
    modelsByPointer,
    operationId,
  );
  const descriptor: ParameterDescriptor = {
    name: parameter.name,
    placement: parameter.placement,
    required: parameter.required,
    schema,
  };
  if (parameter.style !== null) descriptor.style = parameter.style;
  if (parameter.explode !== null) descriptor.explode = parameter.explode;
  if (parameter.placement === 'query' && parameter.allowReserved !== null) {
    descriptor.allowReserved = parameter.allowReserved;
  }
  return descriptor;
}

function resolveParameterSchema(
  schema: unknown,
  modelsByPointer: Map<string, NormalizedModel>,
  active: Set<string>,
  operationId: string,
): Record<string, unknown> {
  if (!isObject(schema)) throw new Error(`Invalid parameter schema for ${operationId}`);
  if (typeof schema.$ref !== 'string') return schema;
  if (active.has(schema.$ref)) throw new Error(`Recursive parameter schema for ${operationId}`);
  const model = modelsByPointer.get(schema.$ref);
  if (model === undefined) throw new Error(`Unresolved parameter schema ${schema.$ref}`);
  const next = new Set(active);
  next.add(schema.$ref);
  return { ...resolveParameterSchema(model.schema, modelsByPointer, next, operationId), ...schema };
}

function simplifyParameterSchema(
  schema: Record<string, unknown>,
  modelsByPointer: Map<string, NormalizedModel>,
  operationId: string,
): Record<string, unknown> {
  const resolved = resolveParameterSchema(schema, modelsByPointer, new Set(), operationId);
  if (
    typeof resolved.type === 'string' &&
    ['boolean', 'integer', 'number', 'string'].includes(resolved.type)
  ) {
    return { type: resolved.type };
  }
  if (resolved.type === 'array') {
    const items = resolveParameterSchema(resolved.items, modelsByPointer, new Set(), operationId);
    if (
      typeof items.type === 'string' &&
      ['boolean', 'integer', 'number', 'string'].includes(items.type)
    ) {
      return { type: 'array', items: { type: items.type } };
    }
  }
  throw new Error(`Unsupported parameter schema for ${operationId}`);
}

function constructExpectedRequest(
  operation: NormalizedOperation,
  parameters: readonly ParameterDescriptor[],
  fixtureArguments: Record<string, unknown>,
  requestBody: OperationRequestBodyContract | null,
): ExpectedRequest {
  let path = operation.path;
  const headers: Record<string, string> = {};
  const query: string[] = [];
  for (const parameter of parameters) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixtureArguments groups by placement are always plain records
    const group = fixtureArguments[parameter.placement] as Record<string, unknown> | undefined;
    const value = group?.[parameter.name];
    if (value === undefined) continue;
    switch (parameter.placement) {
      case 'path':
        path = replacePathParameter(path, parameter.name, value);
        break;
      case 'header':
        headers[parameter.name.toLowerCase()] = serializeHeaderParameter(value);
        break;
      case 'query':
        appendQueryParameter(query, parameter, value);
        break;
    }
  }
  const expected: ExpectedRequest = {
    method: operation.method,
    path: query.length === 0 ? path : `${path}?${query.join('&')}`,
    headers,
  };
  if (requestBody !== null && fixtureArguments.body !== undefined) {
    headers['content-type'] = requestBody.mediaType;
    expected.body = JSON.stringify(fixtureArguments.body);
  }
  return expected;
}

function replacePathParameter(path: string, name: string, value: unknown): string {
  const serialized = Array.isArray(value)
    ? value.map((entry) => encodePath(serializeScalar(entry))).join(',')
    : encodePath(serializeScalar(value));
  return path.replace(`{${name}}`, serialized);
}

function serializeHeaderParameter(value: unknown): string {
  return Array.isArray(value)
    ? value.map((entry) => serializeScalar(entry)).join(',')
    : serializeScalar(value);
}

function appendQueryParameter(
  query: string[],
  parameter: ParameterDescriptor,
  value: unknown,
): void {
  const name = encodeRfc3986(parameter.name);
  if (!Array.isArray(value)) {
    query.push(`${name}=${encodeRfc3986(serializeScalar(value))}`);
    return;
  }
  if (!(parameter.explode ?? true)) {
    query.push(`${name}=${value.map((entry) => encodeRfc3986(serializeScalar(entry))).join(',')}`);
    return;
  }
  if (value.length === 0) query.push(`${name}=`);
  for (const entry of value) query.push(`${name}=${encodeRfc3986(serializeScalar(entry))}`);
}

function assertExactOperationAccounting(model: NormalizedOpenApiModel): void {
  if (
    !isObject(model) ||
    !Array.isArray(model.models) ||
    !Array.isArray(model.operations) ||
    !Array.isArray(model.exclusions) ||
    !isObject(model.accounting)
  ) {
    throw new TypeError('Normalized model must contain operation accounting');
  }
  const operationIds = uniqueIds(
    model.operations.map(({ operationId }) => operationId),
    'operation',
  );
  const exclusionIds = uniqueIds(
    model.exclusions.map(({ operationId }) => operationId),
    'exclusion',
  );
  const sourceIds = uniqueIds(model.accounting.sourceOperationIds, 'source accounting');
  const normalizedIds = uniqueIds(model.accounting.normalizedOperationIds, 'normalized accounting');
  const accountedExclusions = uniqueIds(
    model.accounting.excludedOperationIds,
    'excluded accounting',
  );
  assertSameIds(operationIds, normalizedIds, 'Normalized operation accounting mismatch');
  assertSameIds(exclusionIds, accountedExclusions, 'Excluded operation accounting mismatch');
  assertSameIds(
    new Set([...operationIds, ...exclusionIds]),
    sourceIds,
    'Source operation accounting mismatch',
  );
  for (const operationId of operationIds) {
    if (exclusionIds.has(operationId)) {
      throw new Error(`Operation is both generated and excluded: ${operationId}`);
    }
  }
}

function uniqueIds(values: readonly string[], label: string): Set<string> {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new TypeError(`Invalid ${label} operation IDs`);
  }
  const result = new Set(values);
  if (result.size !== values.length) throw new Error(`Duplicate ${label} operation ID`);
  return result;
}

function assertSameIds(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
  message: string,
): void {
  if (left.size !== right.size || [...left].some((value) => !right.has(value))) {
    throw new Error(message);
  }
}

function selectJsonContent(
  content: readonly { readonly mediaType: string; readonly schema: NormalizedSchema }[],
): { readonly mediaType: string; readonly schema: NormalizedSchema } | null {
  return (
    content
      .filter(({ mediaType }) =>
        /^application\/(?:[A-Z0-9!#$&^_.+-]+\+)?json(?:\s*;.*)?$/iu.test(mediaType),
      )
      .toSorted((left, right) => {
        const leftExact = left.mediaType.toLowerCase() === 'application/json' ? 0 : 1;
        const rightExact = right.mediaType.toLowerCase() === 'application/json' ? 0 : 1;
        return leftExact - rightExact || compareText(left.mediaType, right.mediaType);
      })[0] ?? null
  );
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
  );
}

function encodePath(value: string): string {
  return encodeRfc3986(value).replaceAll('.', '%2E');
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function serializeScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  throw new TypeError('Contract fixture parameter values must be scalars');
}
