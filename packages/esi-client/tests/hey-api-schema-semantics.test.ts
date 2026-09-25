import { readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { generateHeyApiArtifacts } from '@evespace/esi-client-codegen';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import {
  assertSuccessResponseSchemas,
  correctedOpenApiSnapshotPath,
} from '../scripts/generate/hey-api.ts';
import { normalizeOpenApiDocument } from '../scripts/generate/normalize.ts';
import { makeTemporaryDirectory } from './helpers/temporary-directory.js';
import { executeTypeScript } from './helpers/typescript.js';

const semanticDocument = {
  components: {
    schemas: {
      ComposedEntity: {
        allOf: [
          {
            type: 'object',
            required: ['left'],
            properties: { left: { type: 'string' } },
          },
          {
            type: 'object',
            required: ['right'],
            properties: { right: { type: 'integer' } },
          },
        ],
      },
      Dictionary: {
        additionalProperties: { type: 'integer' },
        type: 'object',
      },
      ExclusiveNumber: {
        oneOf: [{ type: 'number' }, { type: 'integer' }],
      },
      RecursiveNode: {
        properties: {
          next: { $ref: '#/components/schemas/RecursiveNode' },
          value: { type: 'string' },
        },
        required: ['value'],
        type: 'object',
      },
      SemanticEntity: {
        properties: {
          birthday: { format: 'date', type: ['string', 'null'] },
          createdAt: { format: 'date-time', type: 'string' },
          exclusive: { $ref: '#/components/schemas/ExclusiveNumber' },
          id: { format: 'int64', maximum: 100, minimum: 1, type: 'integer' },
          members: {
            items: {
              properties: { name: { type: 'string' } },
              required: ['name'],
              type: 'object',
            },
            type: 'array',
            uniqueItems: true,
          },
          metadata: { $ref: '#/components/schemas/Dictionary' },
          name: { maxLength: 8, minLength: 2, pattern: '^[a-z]+$', type: 'string' },
          recursive: { $ref: '#/components/schemas/RecursiveNode' },
          scores: {
            items: { type: 'integer' },
            maxItems: 2,
            minItems: 1,
            type: 'array',
            uniqueItems: true,
          },
          sequence: { default: 9, format: 'int64', type: 'integer' },
        },
        required: ['createdAt', 'id', 'members', 'name', 'scores'],
        type: 'object',
      },
    },
  },
  info: { title: 'Hey API semantic fixture', version: '1.0.0' },
  openapi: '3.1.0',
  paths: {
    '/semantic/{entityId}': {
      post: {
        operationId: 'CreateSemanticEntity',
        parameters: [
          {
            name: 'entityId',
            in: 'path',
            required: true,
            schema: { type: 'integer', format: 'int64', minimum: 1 },
          },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'X-Mode', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SemanticEntity' } },
          },
          required: true,
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SemanticEntity' } },
            },
            description: 'Existing entity',
          },
          201: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SemanticEntity' } },
            },
            description: 'Created entity',
          },
          204: { description: 'No content' },
          205: { description: 'Reset content' },
        },
      },
    },
  },
} as const;

describe('Hey API schema semantics', () => {
  it('preserves legacy validation semantics with natural generated symbols', async () => {
    const directory = await generateFixture(semanticDocument);
    const [typesSource, zodSource] = await Promise.all([
      readFile(join(directory, 'types.gen.ts'), 'utf8'),
      readFile(join(directory, 'zod.gen.ts'), 'utf8'),
    ]);

    expect(typesSource).toContain('[key: string]: unknown;');
    expect(typesSource).toContain('id: number;');
    expect(zodSource).toContain('z.looseObject({');
    expect(zodSource).toContain('z.int().gte(1).lte(100)');
    expect(zodSource).toContain('.default(9)');
    expect(zodSource).not.toContain('BigInt(');
    expect(zodSource).not.toContain('z.coerce.bigint()');
    expect(zodSource).toContain("message: 'Array items must be unique'");
    expect(zodSource).toContain('z.xor([');
    expect(zodSource).toContain('z.iso.datetime({ offset: true })');
    expect(zodSource).toContain('z.iso.date().nullish()');
    expect(zodSource).toContain('z.lazy((): any => zRecursiveNode)');
    expect(zodSource).toContain('z.looseObject({}).catchall(z.int())');

    const generated = await importGeneratedZod(directory);
    const entity = getSchema(generated, 'zSemanticEntity');
    const validEntity = {
      birthday: null,
      createdAt: '2026-09-05T12:30:00+02:00',
      exclusive: 1.5,
      future: { preserved: true },
      id: 7,
      members: [{ name: 'pilot', future: true }],
      metadata: { attempts: 2 },
      name: 'valid',
      recursive: { next: { future: true, value: 'leaf' }, value: 'root' },
      scores: [1, 2],
    };
    expect(entity.parse(validEntity)).toStrictEqual({ ...validEntity, sequence: 9 });
    expect(entity.safeParse({ ...validEntity, id: 1.5 }).success).toBe(false);
    expect(entity.safeParse({ ...validEntity, id: 101 }).success).toBe(false);
    expect(entity.safeParse({ ...validEntity, id: 7n }).success).toBe(false);
    expect(entity.safeParse({ ...validEntity, createdAt: new Date() }).success).toBe(false);
    expect(entity.safeParse({ ...validEntity, createdAt: 'not-a-date' }).success).toBe(false);
    expect(entity.safeParse({ ...validEntity, name: 'A' }).success).toBe(false);
    expect(entity.safeParse({ ...validEntity, scores: [1, 1] }).success).toBe(false);
    expect(entity.safeParse({ ...validEntity, scores: [1, 2, 3] }).success).toBe(false);
    expect(
      entity.safeParse({
        ...validEntity,
        members: [
          { name: 'pilot', rank: 1 },
          { name: 'pilot', rank: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(entity.safeParse({ ...validEntity, metadata: { attempts: 'two' } }).success).toBe(false);
    expect(entity.safeParse({ ...validEntity, exclusive: 1 }).success).toBe(false);
    expect(entity.safeParse({ ...validEntity, birthday: undefined }).success).toBe(true);

    expect(
      getSchema(generated, 'zComposedEntity').parse({ future: true, left: 'yes', right: 2 }),
    ).toStrictEqual({ future: true, left: 'yes', right: 2 });
    expect(
      getSchema(generated, 'zRecursiveNode').parse({
        next: { future: true, value: 'leaf' },
        value: 'root',
      }),
    ).toStrictEqual({ next: { future: true, value: 'leaf' }, value: 'root' });

    const response = getSchema(generated, 'zCreateSemanticEntityResponse');
    expect(response.safeParse(validEntity).success).toBe(true);
    expect(response.parse(undefined)).toBeUndefined();
    expect(response.safeParse(null).success).toBe(false);
  });

  it('compiles natural model, operation, schema, options, and domain contracts', async () => {
    const directory = await generateFixture(semanticDocument);
    await writeFile(join(directory, 'contracts.ts'), compileTimeContracts);
    await symlink(join(process.cwd(), 'node_modules'), join(directory, 'node_modules'), 'dir');
    await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
    await writeFile(
      join(directory, 'tsconfig.json'),
      `${JSON.stringify({
        compilerOptions: {
          lib: ['ES2023'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2023',
          verbatimModuleSyntax: true,
        },
        exclude: ['node_modules'],
        include: ['*.ts'],
      })}\n`,
    );

    await expect(executeTypeScript(directory)).resolves.toBeUndefined();
  });

  it('rejects multiple distinct JSON success schemas and content-bearing 204/205 responses', async () => {
    const multipleSchemas = cloneFixture();
    const responses = fixtureResponses(multipleSchemas);
    const createdContent = getRecord(getRecord(responses, '201'), 'content');
    getRecord(createdContent, 'application/json').schema = {
      $ref: '#/components/schemas/RecursiveNode',
    };
    const multipleModel = await normalizeOpenApiDocument(multipleSchemas);
    expect(() => assertSuccessResponseSchemas(multipleModel)).toThrow(
      'Operation CreateSemanticEntity has multiple distinct JSON success schemas',
    );

    const contentResponse204 = cloneFixture();
    fixtureResponses(contentResponse204)['204'] = invalidNoContentResponse();
    await expect(normalizeOpenApiDocument(contentResponse204)).rejects.toThrow(
      'No-content response CreateSemanticEntity 204 declares content',
    );

    const contentResponse205 = cloneFixture();
    fixtureResponses(contentResponse205)['205'] = invalidNoContentResponse();
    const model = await normalizeOpenApiDocument(contentResponse205);
    expect(() => assertSuccessResponseSchemas(model)).toThrow(
      'No-content response CreateSemanticEntity 205 declares content',
    );
  });

  it(
    'preserves focused semantics from the pinned ESI specification',
    { timeout: 30_000 },
    async () => {
      const document: unknown = JSON.parse(await readFile(correctedOpenApiSnapshotPath, 'utf8'));
      if (!isRecord(document)) {
        throw new TypeError('Expected pinned OpenAPI document');
      }
      const generated = await importGeneratedZod(await generateFixture(document));
      const changelogEntry = {
        compatibility_date: '2026-08-18',
        description: 'Updated response schema.',
        method: 'GET',
        path: '/status',
        type: 'changed',
      };

      const expectations: readonly SchemaExpectation[] = [
        {
          name: 'int64 integer',
          schema: getSchema(generated, 'zAccessListId'),
          valid: [true, true, false, false, false],
          values: [0, 42, 1.5, Number.MAX_SAFE_INTEGER + 1, '42'],
        },
        {
          name: 'date-time, required, optional, reference, and loose object',
          schema: getSchema(generated, 'zAllianceDetail'),
          valid: [true, false, false],
          values: [
            {
              creator_corporation_id: 98_000_001,
              creator_id: 90_000_001,
              date_founded: '2026-09-05T12:30:00+02:00',
              name: 'Alliance',
              ticker: 'ALLY',
              future: { preserved: true },
            },
            {
              creator_corporation_id: 98_000_001,
              creator_id: 90_000_001,
              date_founded: new Date(),
              name: 'Alliance',
              ticker: 'ALLY',
            },
            {
              creator_corporation_id: 98_000_001,
              creator_id: 90_000_001,
              date_founded: 'not-a-date',
              name: 'Alliance',
            },
          ],
        },
        {
          name: 'unique integer array',
          schema: getSchema(generated, 'zAlliancesAllianceIdCorporationsGet'),
          valid: [true, true, true, false, false],
          values: [[], [98_000_001], [98_000_001, 98_000_002], [98_000_001, 98_000_001], [1.5]],
        },
        {
          name: 'optional properties and loose object',
          schema: getSchema(generated, 'zAlliancesAllianceIdIconsGet'),
          valid: [true, true, false],
          values: [
            {},
            { px64x64: 'https://images.evetech.net/icon', future: true },
            { px64x64: false },
          ],
        },
        {
          name: 'oneOf object branches',
          schema: getSchema(generated, 'zCharactersCosmeticsSkinrComponentsItem'),
          valid: [false, false, false, false],
          values: [
            { component_id: 67_890, runs: { remaining: 3 }, type: 'pattern' },
            { component_id: 67_890, runs: { unlimited: true }, type: 'nanocoating' },
            {
              component_id: 67_890,
              runs: { remaining: 3, unlimited: true },
              type: 'pattern',
            },
            { component_id: 67_890, runs: {}, type: 'unknown' },
          ],
        },
        {
          name: 'typed dictionary',
          schema: getSchema(generated, 'zMetaChangelog'),
          valid: [true, false, false],
          values: [
            { changelog: { '2026-08-18': [changelogEntry] }, future: true },
            { changelog: { '2026-08-18': [{ ...changelogEntry, method: 'PATCH' }] } },
            { changelog: { '2026-08-18': changelogEntry } },
          ],
        },
      ];

      for (const expectation of expectations) {
        expect({
          name: expectation.name,
          valid: schemaOutcomes(expectation.schema, expectation.values),
        }).toStrictEqual({
          name: expectation.name,
          valid: expectation.valid,
        });
      }
    },
  );
});

async function generateFixture(document: Readonly<Record<string, unknown>>): Promise<string> {
  const directory = await makeTemporaryDirectory('esi-client-hey-api-semantics-');
  await generateHeyApiArtifacts({ input: document, outputDirectory: directory });
  return directory;
}

async function importGeneratedZod(directory: string): Promise<unknown> {
  const bundlePath = join(directory, 'zod.mjs');
  await build({
    bundle: true,
    entryPoints: [join(directory, 'zod.gen.ts')],
    format: 'esm',
    nodePaths: [join(process.cwd(), 'node_modules')],
    outfile: bundlePath,
    platform: 'node',
    target: 'node22',
  });
  return import(pathToFileURL(bundlePath).href);
}

interface RuntimeSchema {
  parse(value: unknown): unknown;
  safeParse(
    value: unknown,
  ): { readonly data: unknown; readonly success: true } | { readonly success: false };
}

interface SchemaExpectation {
  readonly name: string;
  readonly schema: RuntimeSchema;
  readonly valid: readonly boolean[];
  readonly values: readonly unknown[];
}

function getSchema(module: unknown, name: string): RuntimeSchema {
  if (module === null || typeof module !== 'object') {
    throw new TypeError('Expected schema module');
  }
  const schema: unknown = Reflect.get(module, name);
  if (!isRuntimeSchema(schema)) {
    throw new TypeError(`Expected generated schema ${name}`);
  }
  return schema;
}

function isRuntimeSchema(value: unknown): value is RuntimeSchema {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof Reflect.get(value, 'parse') === 'function' &&
    typeof Reflect.get(value, 'safeParse') === 'function'
  );
}

function schemaOutcomes(schema: RuntimeSchema, values: readonly unknown[]): readonly boolean[] {
  return values.map((value) => schema.safeParse(value).success);
}

function cloneFixture(): Record<string, unknown> {
  const clone: unknown = structuredClone(semanticDocument);
  if (!isRecord(clone)) {
    throw new TypeError('Expected cloned OpenAPI document');
  }
  return clone;
}

function fixtureResponses(document: Record<string, unknown>): Record<string, unknown> {
  return getRecord(
    getRecord(getRecord(getRecord(document, 'paths'), '/semantic/{entityId}'), 'post'),
    'responses',
  );
}

function invalidNoContentResponse() {
  return {
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/SemanticEntity' } },
    },
    description: 'Invalid no-content response',
  };
}

function getRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = value[key];
  if (!isRecord(child)) {
    throw new TypeError(`Expected object at ${key}`);
  }
  return child;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const compileTimeContracts = `import * as z from 'zod';
import {
  zCreateSemanticEntityBody,
  zCreateSemanticEntityHeaders,
  zCreateSemanticEntityPath,
  zCreateSemanticEntityQuery,
  zCreateSemanticEntityResponse,
  zSemanticEntity,
} from './zod.gen.js';
import type {
  CreateSemanticEntityData,
  CreateSemanticEntityResponse,
  CreateSemanticEntityResponses,
  SemanticEntity,
} from './types.gen.js';

type IsExact<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Value extends true> = Value;
type IsMutuallyAssignable<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

export type ModelContract = Assert<IsMutuallyAssignable<z.input<typeof zSemanticEntity>, SemanticEntity>>;
export type BodyContract = Assert<IsMutuallyAssignable<z.input<typeof zCreateSemanticEntityBody>, SemanticEntity>>;
export type PathContract = Assert<IsExact<z.output<typeof zCreateSemanticEntityPath>, CreateSemanticEntityData['path']>>;
export type HeaderContract = Assert<IsExact<z.output<typeof zCreateSemanticEntityHeaders>, NonNullable<CreateSemanticEntityData['headers']>>>;
export type QueryContract = Assert<IsExact<z.output<typeof zCreateSemanticEntityQuery>, NonNullable<CreateSemanticEntityData['query']>>>;
export type Status200Contract = Assert<IsExact<CreateSemanticEntityResponses[200], SemanticEntity>>;
export type Status201Contract = Assert<IsExact<CreateSemanticEntityResponses[201], SemanticEntity>>;
export type Status204Contract = Assert<IsExact<CreateSemanticEntityResponses[204], undefined>>;
export type Status205Contract = Assert<IsExact<CreateSemanticEntityResponses[205], undefined>>;
export type ResponseContract = Assert<IsMutuallyAssignable<z.input<typeof zCreateSemanticEntityResponse>, CreateSemanticEntityResponse>>;
export type ResponseOutputContract = Assert<z.output<typeof zCreateSemanticEntityResponse> extends CreateSemanticEntityResponse ? true : false>;

export type FixtureOperationOptions = Omit<CreateSemanticEntityData, 'body' | 'path' | 'url'>;
export interface FixtureDomainClient {
  createSemanticEntity(
    entityId: number,
    body: SemanticEntity,
    options?: FixtureOperationOptions,
  ): Promise<CreateSemanticEntityResponse>;
}

declare const domain: FixtureDomainClient;
export const result: Promise<CreateSemanticEntityResponse> = domain.createSemanticEntity(
  7,
  {
    id: 7,
    name: 'valid',
    createdAt: '2026-09-05T12:30:00Z',
    scores: [1],
    members: [],
  },
  { headers: { 'X-Mode': 'full' }, query: { page: 2 } },
);
`;
