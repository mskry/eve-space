import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ESI_BASE_URL,
  EsiClientConfiguration,
  PINNED_ESI_COMPATIBILITY_DATE,
} from '../src/client/configuration.js';
import {
  domainClientSourceComponent,
  renderDomainClientArtifacts,
  validateDomainClientArtifacts,
} from '../scripts/generate/domain-client.ts';
import { heyApiSourceComponent } from '../scripts/generate/hey-api.ts';
import type {
  NormalizedOpenApiModel,
  NormalizedOperation,
  NormalizedParameter,
} from '../scripts/generate/normalize.ts';
import type { ResolvedOperationMetadata } from '../scripts/generate/operation-metadata.ts';
import type { EmitterContext } from '../scripts/generate/generation-contracts.ts';
import { createGeneratedSourceEmitter } from '../scripts/generate/source-emitter.ts';
import { operationRegistrySourceComponent } from '../scripts/generate/operation-registry.ts';
import { makeTemporaryDirectory } from './helpers/temporary-directory.js';
import { expectIsolatedDeclarationsCompilation } from './helpers/typescript.js';

const provenance = {
  compatibilityDate: '2026-08-18',
  sha256: 'f'.repeat(64),
};

describe('generated domain clients', () => {
  it('renders deterministic positional identifiers, final options, descriptors, and coverage', () => {
    const model = representativeModel();
    const metadata = representativeMetadata();
    const first = renderDomainClientArtifacts(model, metadata, provenance);
    const second = renderDomainClientArtifacts(
      { ...model, operations: reversed(model.operations) },
      reversed(metadata),
      provenance,
    );

    expect(second).toStrictEqual(first);
    expect(first.domains).toHaveLength(1);
    const domain = first.domains[0];
    if (domain === undefined) {
      throw new Error('Missing domain fixture');
    }
    expect(first.rootIndexSource).toContain("export * from './esi-client.js';");
    expect(first.rootIndexSource).toContain("export * from './domains/index.js';");
    expect(first.rootIndexSource).not.toContain("export * from './schemas/index.js';");
    expect(first.clientSource).toContain('export class EsiClient extends EsiClientBase');
    expect(first.clientSource).toContain('/** Operations for the ESI `items` domain. */');
    expect(first.clientSource).toContain('readonly items: ItemsDomainClient;');
    expect(first.clientSource).toContain('this.items = bindItemsDomainClient(this.configuration);');
    expect(first.indexSource).toContain("export * from './items.js';");
    expect(first.indexSource).not.toContain('operation-coverage');
    expect(domain.contractSource).toContain('export interface ItemsDomainClient');
    expect(domain.contractSource).toContain(
      'getItem(itemId: NonNullable<OperationArguments<GetItemData>[\'path\']>["item_id"], options?: GetItemOptions)',
    );
    expect(domain.contractSource).toContain('readonly "page"?:');
    expect(domain.contractSource).toContain('readonly "ifNoneMatch"?:');
    expect(domain.contractSource).toContain('readonly "compatibilityDate"?: string;');
    expect(domain.contractSource).toContain('readonly "signal"?: AbortSignal;');
    expect(domain.contractSource).toContain(
      'getSummary(options?: GetSummaryOptions): Promise<GetSummaryResponse>',
    );
    expect(domain.contractSource).not.toContain('acceptLanguage');
    expect(domain.contractSource).toContain(
      'createItem(options: CreateItemOptions): Promise<CreateItemResponse>',
    );
    expect(domain.contractSource).toContain(
      'readonly "body": OperationArguments<CreateItemData>[\'body\'];',
    );
    expect(domain.contractSource).toContain('withMetadata(): ItemsDomainClientWithMetadata');
    expect(domain.domainSource).toContain(
      'export function createItemsClient(options: EsiClientOptions = {})',
    );
    expect(domain.domainSource).not.toContain('bindItemsDomainClient(configuration');
    expect(domain.implementationSource).toContain(
      'export function bindItemsDomainClient(configuration: EsiClientConfiguration)',
    );
    expect(domain.implementationSource).toContain(
      'class ItemsDomainClientImplementation implements ItemsDomainClient',
    );
    expect(domain.implementationSource.match(/const arguments_:/gu)).toHaveLength(3);
    expect(domain.implementationSource).toContain(
      'return this.#metadata.getItem(itemId, options).then((response) => response.data);',
    );
    expect(domain.implementationSource).toContain(
      'headers: { "If-None-Match": options?.["ifNoneMatch"], "X-Tenant": options?.["xTenant"] }',
    );
    expect(domain.implementationSource).toContain(
      'arguments_, { compatibilityDate: options?.compatibilityDate, signal: options?.signal });',
    );
    expect(domain.implementationSource).toContain(
      'getSummary(options?: GetSummaryOptions): Promise<EsiResponse<GetSummaryResponse>>',
    );
    expect(domain.implementationSource).toContain(
      'return this.#metadata.getSummary(options).then((response) => response.data);',
    );
    expect(domain.implementationSource).toContain('arguments_, { signal: options?.signal });');
    expect(domain.implementationSource).not.toContain('"signal": options?.');
    expect(domain.descriptorSource).toContain('transport: { compatibilityDateOverride: true }');
    expect(domain.descriptorSource).not.toContain('X-Compatibility-Date');
    expect(
      first.contractsSource.match(/^  readonly "(?:CreateItem|GetItem|GetSummary)": \{$/gmu),
    ).toHaveLength(3);
    expect(first.contractsSource).toContain('GetSummaryOptionsAssertion');
    expect(first.contractsSource).toContain('readonly "signal"?: AbortSignal;');
    expect(first.contractsSource).toContain(
      'IsExact<keyof GeneratedDomainOperationCoverage, keyof GeneratedOperationContractMap>',
    );
    const sources = [
      first.clientSource,
      first.contractsSource,
      first.indexSource,
      first.rootIndexSource,
      ...first.domains.flatMap(
        ({ contractSource, descriptorSource, domainSource, implementationSource }) => [
          contractSource,
          descriptorSource,
          domainSource,
          implementationSource,
        ],
      ),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/[ \t]+$/mu);
    }
  });

  it('emits clients that compile against maintained transport and execute representative calls', async () => {
    const directory = await makeTemporaryDirectory('esi-client-domain-runtime-');
    const outputDirectory = join(directory, 'outputs');
    const sourceDirectory = join(outputDirectory, 'src/generated');
    const model = representativeModel();
    const context = emitterContext(outputDirectory, model);
    const emitter = createGeneratedSourceEmitter([
      heyApiSourceComponent,
      domainClientSourceComponent,
      operationRegistrySourceComponent,
    ]);

    await emitter.emit(context);
    await mkdir(join(outputDirectory, 'src'), { recursive: true });
    await cp(join(process.cwd(), 'src/client'), join(outputDirectory, 'src/client'), {
      recursive: true,
    });
    await expectIsolatedDeclarationsCompilation(outputDirectory);

    const bundlePath = join(outputDirectory, 'items.mjs');
    await build({
      bundle: true,
      entryPoints: [join(sourceDirectory, 'index.ts')],
      format: 'esm',
      nodePaths: [join(process.cwd(), 'node_modules')],
      outfile: bundlePath,
      platform: 'node',
      target: 'node22',
    });
    const imported: unknown = await import(pathToFileURL(bundlePath).href);
    const module = assertDomainModule(imported);
    const requests: Request[] = [];
    const configuration = new EsiClientConfiguration({
      baseUrl: 'https://esi.example.test',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const body = request.method === 'POST' ? { id: 9, name: 'created' } : { id: 7 };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-pages': '4' },
        });
      },
      token: 'secret-token',
      validateRequests: true,
    });
    const domainClient = module.createItemsClient({ fetch: configuration.fetch });
    const minimalClient = new module.EsiClient();
    const client = new module.EsiClient({
      baseUrl: 'https://esi.example.test',
      fetch: configuration.fetch,
      token: 'secret-token',
      validateRequests: true,
    });

    expect(minimalClient.configuration).toMatchObject({
      baseUrl: DEFAULT_ESI_BASE_URL,
      compatibilityDate: PINNED_ESI_COMPATIBILITY_DATE,
    });
    expect(client.configuration).toMatchObject({
      baseUrl: 'https://esi.example.test',
      compatibilityDate: '2026-08-18',
    });
    expect(Object.isFrozen(client)).toBe(true);
    expect(Object.isFrozen(client.configuration)).toBe(true);
    expect(Object.isFrozen(client.items)).toBe(true);
    expect(Object.isFrozen(client.items.withMetadata())).toBe(true);
    expect(client.items.withMetadata()).toBe(client.items.withMetadata());
    expect(() => {
      Object.assign(client, { items: domainClient });
    }).toThrow(TypeError);

    await expect(
      client.items.getItem(7, {
        compatibilityDate: '2026-08-19',
        ifNoneMatch: 'item-etag',
        page: 2,
        xTenant: 'tranquility',
      }),
    ).resolves.toMatchObject({ id: 7 });
    expect(requests[0]?.url).toBe('https://esi.example.test/items/7?page=2');
    expect(requests[0]?.headers.get('if-none-match')).toBe('item-etag');
    expect(requests[0]?.headers.get('x-compatibility-date')).toBe('2026-08-19');
    expect(requests[0]?.headers.get('x-tenant')).toBe('tranquility');

    await expect(client.items.withMetadata().getItem(7)).resolves.toMatchObject({
      data: { id: 7 },
      meta: { pagination: { pages: 4 }, status: 200 },
    });

    await expect(client.items.createItem({ body: { name: 'created' } })).resolves.toMatchObject({
      id: 9,
      name: 'created',
    });
    expect(configuration.allowGenericMutations).toBe(false);
    expect(requests[2]?.method).toBe('POST');
    expect(requests[2]?.headers.get('authorization')).toBe('Bearer secret-token');
    await expect(requests[2]?.json()).resolves.toStrictEqual({ name: 'created' });

    const beforeAbort = requests.length;
    const controller = new AbortController();
    controller.abort();
    await expect(client.items.getItem(7, { signal: controller.signal })).rejects.toMatchObject({
      phase: 'request',
    });
    await expect(
      client.items.withMetadata().getSummary({ signal: controller.signal }),
    ).rejects.toMatchObject({
      phase: 'request',
    });
    await expect(
      client.items.createItem({ body: { name: 'created' }, signal: controller.signal }),
    ).rejects.toMatchObject({
      phase: 'request',
    });
    expect(requests).toHaveLength(beforeAbort);
    await expect(client.items.getSummary()).resolves.toMatchObject({ id: 7 });
  });

  it('rejects metadata gaps and facade option collisions', () => {
    const model = representativeModel();
    expect(() => renderDomainClientArtifacts(model, [], provenance)).toThrow(
      'does not cover every domain operation',
    );

    const operation = makeOperation('Collision', 'GET', '/collision', [
      compatibilityDateParameter(),
      parameter('compatibility_date', 'query', false, { type: 'string' }),
    ]);
    expect(() =>
      renderDomainClientArtifacts(
        normalized([operation]),
        [operationMetadata('Collision', 'collision')],
        provenance,
      ),
    ).toThrow('Facade option collision');

    const signalCollision = {
      ...makeOperation('SignalCollision', 'GET', '/signal-collision', [
        parameter('signal', 'query', false, { type: 'string' }),
      ]),
      extensions: {},
    };
    expect(() =>
      renderDomainClientArtifacts(
        normalized([signalCollision]),
        [operationMetadata('SignalCollision', 'signalCollision')],
        provenance,
      ),
    ).toThrow('Facade option collision');

    const configurationDomainOperation = makeOperation(
      'ConfigurationDomain',
      'GET',
      '/configuration',
      [compatibilityDateParameter()],
    );
    expect(() =>
      renderDomainClientArtifacts(
        normalized([configurationDomainOperation]),
        [
          {
            ...operationMetadata('ConfigurationDomain', 'getConfiguration'),
            domain: 'configuration',
          },
        ],
        provenance,
      ),
    ).toThrow('EsiClient domain property collision: configuration');
  });

  it('rejects missing factories and cross-domain descriptor schema imports', () => {
    const artifacts = renderDomainClientArtifacts(
      representativeModel(),
      representativeMetadata(),
      provenance,
    );
    const domain = artifacts.domains[0];
    if (domain === undefined) {
      throw new Error('Missing domain fixture');
    }
    expect(() =>
      validateDomainClientArtifacts({
        ...artifacts,
        domains: [{ ...domain, domainSource: 'export {};' }],
      }),
    ).toThrow('Missing domain factory');
    expect(() =>
      validateDomainClientArtifacts({
        ...artifacts,
        domains: [
          {
            ...domain,
            descriptorSource: domain.descriptorSource.replace(
              '../../zod.gen.js',
              '../../other-zod.gen.js',
            ),
          },
        ],
      }),
    ).toThrow('outside its domain');
  });
});

interface RuntimeItem {
  readonly id: number;
  readonly name?: string;
}

interface RuntimeGetItemOptions {
  readonly compatibilityDate?: string;
  readonly ifNoneMatch?: string;
  readonly page?: number;
  readonly xTenant?: string;
  readonly signal?: AbortSignal;
}

interface RuntimeItemsMetadataClient {
  getItem(itemId: number, options?: RuntimeGetItemOptions): Promise<{ readonly data: RuntimeItem }>;
  getSummary(options?: { readonly signal?: AbortSignal }): Promise<{ readonly data: RuntimeItem }>;
}

interface RuntimeItemsDomainClient {
  getItem(itemId: number, options?: RuntimeGetItemOptions): Promise<RuntimeItem>;
  getSummary(options?: { readonly signal?: AbortSignal }): Promise<RuntimeItem>;
  createItem(options: {
    readonly body: { readonly name: string };
    readonly signal?: AbortSignal;
  }): Promise<RuntimeItem>;
  withMetadata(): RuntimeItemsMetadataClient;
}

interface RuntimeDomainModule {
  readonly EsiClient: new (options?: {
    readonly baseUrl?: string;
    readonly fetch?: typeof fetch;
    readonly token?: string;
    readonly validateRequests?: boolean;
  }) => {
    readonly configuration: EsiClientConfiguration;
    readonly items: RuntimeItemsDomainClient;
  };
  readonly createItemsClient: (options?: {
    readonly fetch?: typeof fetch;
  }) => RuntimeItemsDomainClient;
}

function assertDomainModule(value: unknown): RuntimeDomainModule {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('EsiClient' in value) ||
    typeof value.EsiClient !== 'function' ||
    !('createItemsClient' in value) ||
    typeof value.createItemsClient !== 'function'
  ) {
    throw new TypeError('Generated items domain module is invalid');
  }
  // The runtime shape was checked above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as unknown as RuntimeDomainModule;
}

function representativeModel(): NormalizedOpenApiModel {
  const getItem = makeOperation('GetItem', 'GET', '/items/{item_id}', [
    parameter('item_id', 'path', true, { format: 'int64', type: 'integer' }),
    parameter('page', 'query', false, { format: 'int32', type: 'integer' }),
    parameter('Accept-Language', 'header', false, { type: 'string' }),
    parameter('If-None-Match', 'header', false, { type: 'string' }),
    compatibilityDateParameter(),
    parameter('X-Tenant', 'header', false, { type: 'string' }),
  ]);
  const createItem = {
    ...makeOperation('CreateItem', 'POST', '/items', [compatibilityDateParameter()]),
    requestBody: {
      content: [
        {
          mediaType: 'application/json',
          schema: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
          extensions: {},
        },
      ],
      description: null,
      extensions: {},
      required: true,
    },
    security: [{ schemes: [{ name: 'OAuth2', scopes: ['esi-items.write.v1'] }] }],
  } satisfies NormalizedOperation;
  const getSummary = { ...makeOperation('GetSummary', 'GET', '/summary', []), extensions: {} };
  return {
    ...normalized([getItem, createItem, getSummary]),
    models: [
      {
        name: 'Item',
        pointer: '#/components/schemas/Item',
        schema: {
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
          required: ['id'],
          type: 'object',
        },
      },
    ],
  };
}

function representativeMetadata(): ResolvedOperationMetadata[] {
  return [
    operationMetadata('CreateItem', 'createItem', 'mutation'),
    operationMetadata('GetItem', 'getItem'),
    operationMetadata('GetSummary', 'getSummary'),
  ];
}

function operationMetadata(
  operationId: string,
  method: string,
  classification: 'mutation' | 'read' = 'read',
): ResolvedOperationMetadata {
  return {
    classification,
    domain: 'items',
    method,
    operationId,
    safetyOverrideReason: null,
  };
}

function makeOperation(
  operationId: string,
  method: NormalizedOperation['method'],
  path: string,
  parameters: readonly NormalizedParameter[],
): NormalizedOperation {
  return {
    cache: { extensions: {}, responseHeaders: [] },
    conditionalRequestValidators: [],
    description: null,
    domainSource: 'Items',
    extensions: { 'x-compatibility-date': '2026-08-18' },
    maximumBatchSize: null,
    method,
    operationId,
    pagination: { kind: 'none', requestParameters: [], responseHeaders: [] },
    parameters,
    path,
    rateLimit: { kind: 'legacy-only' },
    requestArrayLimits: [],
    requestBody: null,
    security: [],
    successResponses: [
      {
        status: '200',
        description: 'Success',
        noContent: false,
        content: [
          {
            mediaType: 'application/json',
            schema: { $ref: '#/components/schemas/Item' },
            extensions: {},
          },
        ],
        headers: [],
        extensions: {},
      },
    ],
    summary: null,
    tags: ['Items'],
  };
}

function compatibilityDateParameter(): NormalizedParameter {
  return parameter('X-Compatibility-Date', 'header', true, {
    enum: ['2026-08-18'],
    format: 'date',
    type: 'string',
  });
}

function parameter(
  name: string,
  placement: NormalizedParameter['placement'],
  required: boolean,
  schema: NormalizedParameter['schema'],
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

function normalized(operations: readonly NormalizedOperation[]): NormalizedOpenApiModel {
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

function emitterContext(
  outputDirectory: string,
  normalizedModel: NormalizedOpenApiModel,
): EmitterContext {
  return {
    compatibilityDate: provenance.compatibilityDate,
    correctedDocument: representativeOpenApiDocument(),
    namingReviewReport: 'test naming review\n',
    normalizedModel,
    operationMetadata: representativeMetadata(),
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

function representativeOpenApiDocument() {
  const commonParameters = [
    {
      in: 'header',
      name: 'Accept-Language',
      schema: { default: 'en', type: 'string' },
    },
    {
      in: 'header',
      name: 'X-Compatibility-Date',
      required: true,
      schema: { enum: ['2026-08-18'], type: 'string' },
    },
  ];
  return {
    components: {
      schemas: {
        Item: {
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
          required: ['id'],
          type: 'object',
        },
      },
    },
    info: { title: 'Domain fixture', version: '1.0.0' },
    openapi: '3.1.0',
    paths: {
      '/summary': {
        get: {
          operationId: 'GetSummary',
          responses: {
            200: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Item' } },
              },
              description: 'Success',
            },
          },
        },
      },
      '/items': {
        post: {
          operationId: 'CreateItem',
          parameters: commonParameters,
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  properties: { name: { type: 'string' } },
                  required: ['name'],
                  type: 'object',
                },
              },
            },
            required: true,
          },
          responses: {
            200: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Item' } },
              },
              description: 'Success',
            },
          },
        },
      },
      '/items/{item_id}': {
        get: {
          operationId: 'GetItem',
          parameters: [
            ...commonParameters,
            { name: 'item_id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'If-None-Match', in: 'header', schema: { type: 'string' } },
            {
              name: 'X-Tenant',
              in: 'header',
              schema: { type: 'string', default: 'tranquility' },
            },
          ],
          responses: {
            200: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Item' } },
              },
              description: 'Success',
            },
          },
        },
      },
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
