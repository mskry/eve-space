import { execFile } from 'node:child_process';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import type {
  NormalizedOpenApiModel,
  NormalizedOperation,
  NormalizedParameter,
  NormalizedSchema,
} from '../scripts/generate/normalize.ts';
import {
  generatedOperationContractTestsComponent,
  renderGeneratedOperationContractTests,
} from '../scripts/generate/operation-contract-test-emitter.ts';
import type { EmitterContext } from '../scripts/generate/generation-contracts.ts';
import { createGeneratedTestsEmitter } from '../scripts/generate/test-emitter.ts';
import { makeTemporaryDirectory } from './helpers/temporary-directory.js';

const executeFile = promisify(execFile);
const provenance = {
  compatibilityDate: '2026-08-18',
  sha256: 'd'.repeat(64),
};

describe('generated operation contract tests', () => {
  it('renders deterministic complete request, auth, and response contracts', () => {
    const model = representativeModel();
    const first = renderGeneratedOperationContractTests(model, provenance);
    const second = renderGeneratedOperationContractTests(
      {
        ...model,
        operations: reversed(model.operations),
      },
      provenance,
    );

    expect(second).toBe(first);
    expect(first).toContain("it('accounts for exactly all 2 operations'");
    expect(first).toContain('"method": "GET"');
    expect(first).toContain('"pathTemplate": "/things/{thing_id}"');
    expect(first).toContain('"placement": "path"');
    expect(first).toContain('"placement": "query"');
    expect(first).toContain('"placement": "header"');
    expect(first).toContain('"required": true');
    expect(first).toContain('"scopes": [\n        "esi-things.read.v1"');
    expect(first).toContain('"body": "none"');
    expect(first).toContain('"content-type": "application/json"');
    expect(first).toContain('zPutThingResponse');
  });

  it('fails generation for unsupported required fixture shapes and invalid accounting', () => {
    const model = representativeModel();
    const unsupported = {
      ...model,
      operations: [
        {
          ...model.operations[0],
          parameters: [parameter('filter', 'query', true, { type: 'object' })],
        },
        model.operations[1],
      ],
    } satisfies NormalizedOpenApiModel;
    const unaccounted = {
      ...model,
      accounting: { ...model.accounting, sourceOperationIds: ['GetThing'] },
    } satisfies NormalizedOpenApiModel;

    expect(() => renderGeneratedOperationContractTests(unsupported, provenance)).toThrow(
      'Unsupported required parameter fixture GetThing:query:filter',
    );
    expect(() => renderGeneratedOperationContractTests(unaccounted, provenance)).toThrow(
      'Source operation accounting mismatch',
    );
  });

  it('emits the pinned 233-operation suite and compiles and runs it in a staged tree', async () => {
    const directory = await makeTemporaryDirectory('esi-client-operation-contract-tests-');
    const outputDirectory = join(directory, 'outputs');
    const model = await readNormalizedModel();
    const context = emitterContext(outputDirectory, model);
    const emitter = createGeneratedTestsEmitter([generatedOperationContractTestsComponent]);

    await expect(emitter.emit(context)).resolves.toStrictEqual([
      { kind: 'directory', target: 'tests/generated' },
    ]);
    const generatedPath = join(outputDirectory, 'tests/generated/operation-contracts.test.ts');
    await expect(readFile(generatedPath, 'utf8')).resolves.toContain(
      "it('accounts for exactly all 233 operations'",
    );

    await symlink(
      join(process.cwd(), 'node_modules'),
      join(outputDirectory, 'node_modules'),
      'dir',
    );
    await symlink(join(process.cwd(), 'src'), join(outputDirectory, 'src'), 'dir');
    await writeFile(join(outputDirectory, 'package.json'), '{"type":"module"}\n');
    await writeFile(
      join(outputDirectory, 'tsconfig.json'),
      `${JSON.stringify({
        compilerOptions: {
          lib: ['ES2022', 'DOM'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
          types: ['node', 'vitest/globals'],
          verbatimModuleSyntax: true,
        },
        include: ['tests/**/*.ts'],
      })}\n`,
    );

    await expect(
      executeFile(
        process.execPath,
        [join(process.cwd(), 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
        {
          cwd: outputDirectory,
          maxBuffer: 10 * 1024 * 1024,
        },
      ),
    ).resolves.toBeDefined();
    await expect(
      executeFile(
        process.execPath,
        [
          join(process.cwd(), 'node_modules/vitest/vitest.mjs'),
          'run',
          'tests/generated/operation-contracts.test.ts',
        ],
        { cwd: outputDirectory, maxBuffer: 10 * 1024 * 1024 },
      ),
    ).resolves.toMatchObject({ stdout: expect.stringContaining('passed') });
  }, 60_000);
});

function representativeModel(): NormalizedOpenApiModel {
  const operations = [
    operation({
      method: 'GET',
      operationId: 'GetThing',
      parameters: [
        parameter('thing_id', 'path', true, { type: 'integer', minimum: 1 }),
        parameter('labels', 'query', true, {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: ['active'] },
        }),
        parameter('X-Trace', 'header', false, { type: 'string', minLength: 1 }),
      ],
      path: '/things/{thing_id}',
      security: [{ schemes: [{ name: 'oauth2', scopes: ['esi-things.read.v1'] }] }],
      successResponses: [jsonResponse('200', { type: 'object', properties: {} })],
    }),
    operation({
      method: 'PUT',
      operationId: 'PutThing',
      parameters: [parameter('thing_id', 'path', true, { type: 'integer', minimum: 1 })],
      path: '/things/{thing_id}',
      requestBody: {
        content: [
          {
            mediaType: 'application/json',
            schema: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string', minLength: 1 } },
            },
            extensions: {},
          },
        ],
        description: null,
        extensions: {},
        required: true,
      },
      successResponses: [noContentResponse('204')],
    }),
  ];
  const operationIds = operations.map(({ operationId }) => operationId);
  return {
    accounting: {
      excludedOperationIds: [],
      normalizedOperationIds: operationIds,
      sourceOperationIds: operationIds,
    },
    exclusions: [],
    inventory: { openapi: [], schemas: [] },
    models: [],
    operations,
  };
}

function operation(
  overrides: Partial<NormalizedOperation> &
    Pick<NormalizedOperation, 'operationId' | 'method' | 'path'>,
): NormalizedOperation {
  return {
    cache: { extensions: {}, responseHeaders: [] },
    conditionalRequestValidators: [],
    description: null,
    domainSource: 'Things',
    extensions: {},
    maximumBatchSize: null,
    pagination: { kind: 'none', requestParameters: [], responseHeaders: [] },
    parameters: [],
    rateLimit: { kind: 'legacy-only' },
    requestArrayLimits: [],
    requestBody: null,
    security: [],
    successResponses: [jsonResponse('200', { type: 'object', properties: {} })],
    summary: null,
    tags: ['Things'],
    ...overrides,
  };
}

function parameter(
  name: string,
  placement: NormalizedParameter['placement'],
  required: boolean,
  schema: NormalizedSchema,
): NormalizedParameter {
  return {
    allowReserved: null,
    deprecated: false,
    description: null,
    explode: null,
    extensions: {},
    name,
    placement,
    required,
    schema,
    style: null,
  };
}

function jsonResponse(status: string, schema: NormalizedSchema) {
  return {
    content: [{ mediaType: 'application/json', schema, extensions: {} }],
    description: 'Success',
    extensions: {},
    headers: [],
    noContent: false,
    status,
  };
}

function noContentResponse(status: string) {
  return {
    content: [],
    description: 'No content',
    extensions: {},
    headers: [],
    noContent: true,
    status,
  };
}

async function readNormalizedModel(): Promise<NormalizedOpenApiModel> {
  const value: unknown = JSON.parse(
    await readFile(new URL('../openapi/generated/normalized-model.json', import.meta.url), 'utf8'),
  );
  if (value === null || typeof value !== 'object' || !('operations' in value)) {
    throw new TypeError('Invalid committed normalized model');
  }
  // The generated operation suite validates the complete shape operation by operation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as NormalizedOpenApiModel;
}

function emitterContext(
  outputDirectory: string,
  normalizedModel: NormalizedOpenApiModel,
): EmitterContext {
  return {
    compatibilityDate: provenance.compatibilityDate,
    correctedDocument: {},
    namingReviewReport: 'test naming review\n',
    normalizedModel,
    operationMetadata: [],
    outputDirectory,
    outputPath: (target) => join(outputDirectory, target),
    provenance: {
      ...provenance,
      appliedCorrections: [],
      facadeCatalog: { path: 'openapi/config/naming-overrides.json', sha256: 'd'.repeat(64) },
      facadeReviewReport: {
        path: 'docs/generated/facade-naming-review.md',
        sha256: 'e'.repeat(64),
      },
      operationProtocolFactsSha256: 'f'.repeat(64),
      sourceSha256: 'e'.repeat(64),
      specificationUrl: 'https://example.test/openapi.json',
    },
  };
}

function reversed<Value>(values: readonly Value[]): Value[] {
  const result: Value[] = [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined) {
      result.push(value);
    }
  }
  return result;
}
