import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeOpenApiDocument, resolveLocalReference } from '../scripts/generate/normalize.ts';
import { makeTemporaryDirectory } from './helpers/temporary-directory.js';

describe('normalized OpenAPI model', () => {
  it('resolves local operation references and captures emitter inputs', async () => {
    const result = await normalizeOpenApiDocument(referencedDocument());

    expect(result.operations.map(({ operationId }) => operationId)).toStrictEqual([
      'get_item',
      'remove_item',
    ]);
    expect(result.models.map(({ name }) => name)).toStrictEqual(['Alpha', 'Zeta']);
    expect(result.operations[0]).toMatchObject({
      cache: {
        extensions: { 'x-cache-age': 60 },
        responseHeaders: ['etag'],
      },
      conditionalRequestValidators: [],
      description: 'Returns one item.',
      domainSource: 'Zeta',
      extensions: { 'x-cache-age': 60, 'x-owner': 'items' },
      maximumBatchSize: null,
      method: 'GET',
      operationId: 'get_item',
      pagination: {
        kind: 'offset',
        requestParameters: ['page'],
        responseHeaders: ['x-pages'],
      },
      parameters: [
        {
          name: 'item_id',
          placement: 'path',
          required: true,
          schema: { type: 'integer' },
        },
        {
          name: 'page',
          placement: 'query',
          required: false,
          schema: { minimum: 1, type: 'integer' },
        },
      ],
      path: '/items/{item_id}',
      rateLimit: { kind: 'legacy-only' },
      requestArrayLimits: [],
      requestBody: {
        content: [
          {
            mediaType: 'application/json',
            schema: { $ref: '#/components/schemas/Zeta' },
          },
        ],
        required: true,
      },
      security: [{ schemes: [{ name: 'esiOAuth', scopes: ['esi-items.read'] }] }],
      successResponses: [
        {
          status: '200',
          noContent: false,
          headers: [
            { name: 'ETag', schema: { type: 'string' } },
            { name: 'X-Pages', schema: { minimum: 1, type: 'integer' } },
          ],
          content: [
            {
              mediaType: 'application/json',
              schema: { $ref: '#/components/schemas/Zeta' },
            },
          ],
        },
      ],
      summary: 'Get an item',
      tags: ['Alpha', 'Zeta'],
    });
    expect(result.operations[1]?.successResponses).toStrictEqual([
      {
        content: [],
        description: 'Removed',
        extensions: {},
        headers: [],
        noContent: true,
        status: '204',
      },
    ]);
    expect(result.accounting).toStrictEqual({
      excludedOperationIds: [],
      normalizedOperationIds: ['get_item', 'remove_item'],
      sourceOperationIds: ['get_item', 'remove_item'],
    });
  });

  it('sorts operation, model, parameter, response, header, media, and inventory collections', async () => {
    const document = referencedDocument();
    const reordered = reverseObjectEntries(document);
    if (!isRecord(reordered)) {
      throw new TypeError('Reordered fixture must remain an object');
    }

    const first = await normalizeOpenApiDocument(document);
    const second = await normalizeOpenApiDocument(reordered);

    expect(second).toStrictEqual(first);
    expect(first.operations[0]?.parameters.map(({ name }) => name)).toStrictEqual([
      'item_id',
      'page',
    ]);
    expect(isSorted(first.inventory.openapi.map(({ construct }) => construct))).toBe(true);
    expect(isSorted(first.inventory.schemas.map(({ construct }) => construct))).toBe(true);
  });

  it('inventories OpenAPI and schema constructs with deterministic counts', async () => {
    const { inventory } = await normalizeOpenApiDocument(referencedDocument());

    expect(inventory.openapi).toStrictEqual(
      expect.arrayContaining([
        { construct: 'extension:x-cache-age', count: 1 },
        { construct: 'media-type:application/json', count: 2 },
        { construct: 'operation:delete', count: 1 },
        { construct: 'operation:get', count: 1 },
        { construct: 'parameter:path', count: 1 },
        { construct: 'parameter:query', count: 1 },
        { construct: 'version:3.1.0', count: 1 },
      ]),
    );
    expect(inventory.schemas).toStrictEqual(
      expect.arrayContaining([
        { construct: 'keyword:$ref', count: 2 },
        { construct: 'keyword:properties', count: 2 },
        { construct: 'type:integer', count: 4 },
        { construct: 'type:object', count: 2 },
        { construct: 'type:string', count: 3 },
      ]),
    );
  });

  it('accounts for reviewed exclusions with machine-readable reasons', async () => {
    const exclusionsPath = await writeExclusions([
      {
        operationId: 'remove_item',
        reason: { code: 'unsupported-callback', detail: 'Requires callback emitter support.' },
        reviewed: true,
      },
    ]);

    const result = await normalizeOpenApiDocument(referencedDocument(), { exclusionsPath });

    expect(result.operations.map(({ operationId }) => operationId)).toStrictEqual(['get_item']);
    expect(result.exclusions).toStrictEqual([
      {
        operationId: 'remove_item',
        reason: { code: 'unsupported-callback', detail: 'Requires callback emitter support.' },
        reviewed: true,
      },
    ]);
    expect(result.accounting.excludedOperationIds).toStrictEqual(['remove_item']);
  });

  it('normalizes protocol declarations and only derives an unambiguous maximum batch size', async () => {
    const document = minimalDocument({
      '/ambiguous': {
        post: {
          ...jsonOperation('ambiguous_arrays'),
          parameters: [
            parameter('ids', 'query', false, {
              type: 'array',
              maxItems: 20,
              items: { type: 'integer' },
            }),
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  properties: {
                    recipients: {
                      items: { type: 'integer' },
                      maxItems: 50,
                      type: 'array',
                    },
                  },
                  type: 'object',
                },
              },
            },
          },
        },
      },
      '/batch': {
        post: {
          ...jsonOperation('batch_items'),
          parameters: [
            parameter('If-None-Match', 'header', false, { type: 'string' }),
            parameter('If-Modified-Since', 'header', false, { type: 'string' }),
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: { items: { type: 'integer' }, maxItems: 100, type: 'array' },
              },
            },
            required: true,
          },
          'x-cache-age': 60,
          'x-cache-mode': 'ttl-based',
          'x-client-cache-ttl': 60,
          'x-rate-limit': {
            group: 'batch-items',
            'max-tokens': 600,
            'window-size': '15m',
          },
          'x-server-cache-mode': 'event-based',
          'x-server-cache-ttl': 300,
          'x-tombstone-ttl': 604_800,
        },
      },
    });

    const result = await normalizeOpenApiDocument(document);
    const batch = result.operations.find(({ operationId }) => operationId === 'batch_items');
    const ambiguous = result.operations.find(
      ({ operationId }) => operationId === 'ambiguous_arrays',
    );

    expect(batch).toMatchObject({
      cache: {
        extensions: {
          'x-cache-age': 60,
          'x-cache-mode': 'ttl-based',
          'x-client-cache-ttl': 60,
          'x-server-cache-mode': 'event-based',
          'x-server-cache-ttl': 300,
          'x-tombstone-ttl': 604_800,
        },
      },
      conditionalRequestValidators: ['if-modified-since', 'if-none-match'],
      maximumBatchSize: 100,
      rateLimit: {
        group: 'batch-items',
        kind: 'declared',
        maximumTokens: 600,
        window: '15m',
      },
      requestArrayLimits: [{ location: 'body', path: [], maximumItems: 100 }],
    });
    expect(ambiguous).toMatchObject({
      conditionalRequestValidators: [],
      maximumBatchSize: null,
      rateLimit: { kind: 'legacy-only' },
      requestArrayLimits: [
        { location: 'body', path: ['recipients'], maximumItems: 50 },
        { location: 'query', path: ['ids'], maximumItems: 20 },
      ],
    });
  });

  it.each([
    ['unsupported cache extension', { 'x-cache-policy': 'ttl' }, 'Unsupported cache extension'],
    ['malformed cache age', { 'x-cache-age': '60' }, 'Invalid x-cache-age extension'],
    ['unsupported cache mode', { 'x-cache-mode': 'fixed' }, 'Invalid x-cache-mode extension'],
    ['malformed tombstone TTL', { 'x-tombstone-ttl': -1 }, 'Invalid x-tombstone-ttl extension'],
    ['malformed rate extension', { 'x-rate-limit': 'legacy' }, 'must be an object'],
    [
      'unknown rate field',
      {
        'x-rate-limit': {
          burst: 1,
          group: 'items',
          'max-tokens': 10,
          'window-size': '15m',
        },
      },
      'Unknown x-rate-limit extension',
    ],
    [
      'invalid rate maximum',
      { 'x-rate-limit': { group: 'items', 'max-tokens': 0, 'window-size': '15m' } },
      'Invalid x-rate-limit max-tokens',
    ],
    [
      'invalid rate window',
      { 'x-rate-limit': { group: 'items', 'max-tokens': 10, 'window-size': 'fifteen' } },
      'Invalid x-rate-limit window-size',
    ],
  ])('rejects a %s before producing a normalized model', async (_case, extensions, message) => {
    const document = minimalDocument({
      '/items': { get: { ...jsonOperation('get_items'), ...extensions } },
    });
    await expect(normalizeOpenApiDocument(document)).rejects.toThrow(message);
  });

  it.each([
    [
      'duplicate',
      [reviewedExclusion('get_item'), reviewedExclusion('get_item')],
      'Duplicate operation exclusion: get_item',
    ],
    ['stale', [reviewedExclusion('removed_operation')], 'Stale or unknown operation exclusion'],
    [
      'unreviewed',
      [{ ...reviewedExclusion('get_item'), reviewed: false }],
      'Operation exclusion is not reviewed',
    ],
    [
      'unknown fields',
      [{ ...reviewedExclusion('get_item'), owner: 'generator' }],
      'Unknown operation exclusion 0 field',
    ],
  ])('rejects %s exclusion entries', async (_case, exclusions, message) => {
    const exclusionsPath = await writeExclusions(exclusions);
    await expect(
      normalizeOpenApiDocument(referencedDocument(), { exclusionsPath }),
    ).rejects.toThrow(message);
  });

  it('detects missing and duplicate operation IDs before accounting', async () => {
    await expect(
      normalizeOpenApiDocument(minimalDocument({ '/missing': { get: operation() } })),
    ).rejects.toThrow('Missing or invalid operationId for GET /missing');
    await expect(
      normalizeOpenApiDocument(
        minimalDocument({
          '/first': { get: operation('duplicate') },
          '/second': { post: operation('duplicate') },
        }),
      ),
    ).rejects.toThrow('Duplicate operationId duplicate');
  });

  it.each([
    ['unresolved', '#/components/schemas/Missing', 'Unresolved local OpenAPI reference'],
    [
      'external',
      'other.json#/components/schemas/Result',
      'External or unsupported OpenAPI reference',
    ],
    ['anchor', '#Result', 'External or unsupported OpenAPI reference'],
  ])('rejects %s schema references', async (_case, reference, message) => {
    const document = minimalDocument({
      '/result': {
        get: operation('get_result', {
          content: { 'application/json': { schema: { $ref: reference } } },
        }),
      },
    });
    await expect(normalizeOpenApiDocument(document)).rejects.toThrow(message);
  });

  it('resolves escaped and URI-encoded local JSON Pointer segments', () => {
    const document = {
      components: {
        schemas: {
          'A/B~ C': { oneOf: [{ type: 'string' }, { type: 'number' }] },
        },
      },
    };
    expect(resolveLocalReference(document, '#/components/schemas/A~1B~0%20C')).toStrictEqual({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    });
    expect(
      resolveLocalReference(document, '#/components/schemas/A~1B~0%20C/oneOf/1'),
    ).toStrictEqual({
      type: 'number',
    });
  });
});

function referencedDocument() {
  return {
    components: {
      headers: {
        Pages: {
          schema: { minimum: 1, type: 'integer' },
        },
      },
      parameters: {
        ItemId: {
          in: 'path',
          name: 'item_id',
          required: true,
          schema: { type: 'integer' },
        },
        Page: {
          in: 'query',
          name: 'page',
          schema: { minimum: 1, type: 'integer' },
        },
      },
      pathItems: {
        Item: {
          get: {
            description: 'Returns one item.',
            operationId: 'get_item',
            parameters: [{ $ref: '#/components/parameters/Page' }],
            requestBody: { $ref: '#/components/requestBodies/ItemBody' },
            responses: { '200': { $ref: '#/components/responses/Item' } },
            security: [{ esiOAuth: ['esi-items.read'] }],
            summary: 'Get an item',
            tags: ['Zeta', 'Alpha'],
            'x-cache-age': 60,
            'x-owner': 'items',
          },
          parameters: [{ $ref: '#/components/parameters/ItemId' }],
        },
      },
      requestBodies: {
        ItemBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Zeta' } },
          },
          required: true,
        },
      },
      responses: {
        Item: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Zeta' } },
          },
          description: 'An item',
          headers: {
            ETag: { schema: { type: 'string' } },
            'X-Pages': { $ref: '#/components/headers/Pages' },
          },
        },
      },
      schemas: {
        Alpha: {
          properties: { created_at: { format: 'date-time', type: 'string' } },
          type: 'object',
        },
        Zeta: {
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
          },
          required: ['name', 'id'],
          type: 'object',
        },
      },
      securitySchemes: {
        esiOAuth: { flows: {}, type: 'oauth2' },
      },
    },
    info: { title: 'Normalization fixture', version: '1.0.0' },
    openapi: '3.1.0',
    paths: {
      '/items/{item_id}': { $ref: '#/components/pathItems/Item' },
      '/removed': {
        delete: operation('remove_item'),
      },
    },
  };
}

function minimalDocument(paths: Record<string, object>) {
  return {
    info: { title: 'Minimal fixture', version: '1.0.0' },
    openapi: '3.1.0',
    paths,
  };
}

function operation(operationId?: string, response: object = { description: 'Removed' }) {
  return {
    ...(operationId === undefined ? {} : { operationId }),
    responses: { '204': response },
  };
}

function jsonResponse() {
  return {
    content: { 'application/json': { schema: { type: 'object' } } },
    description: 'OK',
  };
}

function jsonOperation(operationId: string) {
  return { operationId, responses: { '200': jsonResponse() } };
}

function parameter(name: string, placement: string, required: boolean, schema: object) {
  return { in: placement, name, required, schema };
}

function reviewedExclusion(operationId: string) {
  return {
    operationId,
    reason: { code: 'unsupported-test', detail: 'Excluded by a test fixture.' },
    reviewed: true,
  };
}

async function writeExclusions(exclusions: readonly object[]): Promise<string> {
  const directory = await makeTemporaryDirectory('esi-client-exclusions-');
  const path = join(directory, 'exclusions.json');
  await writeFile(path, `${JSON.stringify({ exclusions, schemaVersion: 1 })}\n`);
  return path;
}

function reverseObjectEntries(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseObjectEntries);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const entries = Object.entries(value);
  const reversed: Record<string, unknown> = {};
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry) {
      reversed[entry[0]] = reverseObjectEntries(entry[1]);
    }
  }
  return reversed;
}

function isSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || (values[index - 1]?.localeCompare(value, 'en') ?? 0) <= 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
