import { lstat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { createHeyApiGenerationConfig } from '@evespace/esi-client-codegen';
import { describe, expect, it, vi } from 'vitest';

import {
  checkHeyApiShadowGeneration,
  correctedOpenApiSnapshotPath,
  createDeclarationCompilerArguments,
} from '../scripts/generate/hey-api.ts';
import { generationCheckTargets } from '../scripts/generate/check.ts';

const correctedDocument = {
  components: {
    schemas: {
      Status: {
        properties: { players: { type: 'integer' } },
        required: ['players'],
        type: 'object',
      },
    },
  },
  info: { title: 'Shadow fixture', version: '1.0.0' },
  openapi: '3.1.0',
  paths: {
    '/status/{cluster}': {
      get: {
        operationId: 'GetStatus',
        parameters: [
          {
            name: 'cluster',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          { name: 'language', in: 'query', schema: { type: 'string' } },
          { name: 'X-Compatibility-Date', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Status' } },
            },
            description: 'OK',
          },
        },
      },
    },
  },
};

describe('isolated Hey API shadow generation', () => {
  it('forces LF bytes for production Zod declaration emission', () => {
    const compilerArguments = createDeclarationCompilerArguments('input/zod.gen.ts', 'output');

    expect(
      compilerArguments.slice(
        compilerArguments.indexOf('--newLine'),
        compilerArguments.indexOf('--newLine') + 2,
      ),
    ).toStrictEqual(['--newLine', 'lf']);
  });

  it('uses only the explicit TypeScript and Zod 4 generation configuration', () => {
    const outputDirectory = join(tmpdir(), 'hey-api-config-fixture');

    expect(
      createHeyApiGenerationConfig({ input: correctedDocument, outputDirectory }),
    ).toStrictEqual({
      input: correctedDocument,
      interactive: false,
      logs: { file: false, level: 'silent' },
      output: {
        clean: true,
        entryFile: true,
        module: { extension: '.js' },
        path: outputDirectory,
        postProcess: [],
        source: false,
        tsConfigPath: null,
      },
      parser: { patch: { input: expect.any(Function) } },
      plugins: [
        {
          name: '@hey-api/typescript',
          definitions: { name: '{{name}}' },
          requests: { name: '{{name}}Data' },
          responses: { name: '{{name}}Responses', response: '{{name}}Response' },
          $resolvers: { object: expect.any(Function), string: expect.any(Function) },
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
          $resolvers: {
            array: expect.any(Function),
            number: expect.any(Function),
            object: expect.any(Function),
            string: expect.any(Function),
            union: expect.any(Function),
          },
        },
      ],
    });
    expect(
      createHeyApiGenerationConfig({ input: correctedOpenApiSnapshotPath, outputDirectory }).input,
    ).toBe(correctedOpenApiSnapshotPath);
  });

  it(
    'runs twice from local in-memory input and cleans both OS temporary workspaces',
    { timeout: 30_000 },
    async () => {
      const originalFetch = globalThis.fetch;
      const networkFetch = vi.fn<() => Promise<never>>(async () => {
        throw new Error('network access is forbidden');
      });
      globalThis.fetch = networkFetch;

      try {
        const result = await checkHeyApiShadowGeneration({ correctedDocument });

        expect(networkFetch).not.toHaveBeenCalled();
        expect(result.paths).toStrictEqual(['index.ts', 'types.gen.ts', 'zod.gen.ts']);
        expect(result.fileCount).toBe(3);
        expect(result.operationAccounting).toStrictEqual({
          generated: 1,
          reviewedExcluded: 0,
          source: 1,
        });
        expect(result.temporaryDirectories).toHaveLength(2);
        expect(new Set(result.temporaryDirectories)).toHaveLength(2);
        for (const directory of result.temporaryDirectories) {
          expect(relative(tmpdir(), directory)).not.toMatch(/^\.\./u);
          await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  it(
    'accounts for every operation and validates natural symbols for the committed snapshot',
    { timeout: 120_000 },
    async () => {
      const originalFetch = globalThis.fetch;
      const networkFetch = vi.fn<() => Promise<never>>(async () => {
        throw new Error('network access is forbidden');
      });
      globalThis.fetch = networkFetch;

      try {
        const result = await checkHeyApiShadowGeneration();

        expect(networkFetch).not.toHaveBeenCalled();
        expect(result.operationAccounting).toStrictEqual({
          generated: 233,
          reviewedExcluded: 0,
          source: 233,
        });
        expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  it('keeps the authoritative generation drift check separate and unchanged', async () => {
    const packageJson: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );

    expect(packageJson).toMatchObject({
      scripts: {
        'generate:check': 'node scripts/generate/check.ts',
        'generate:shadow:check': 'node scripts/generate/hey-api-shadow.ts',
      },
    });
    expect(generationCheckTargets).toStrictEqual([
      'src/generated',
      'llms.txt',
      'docs/generated',
      'docs/llms.txt',
      'examples/generated',
      'tests/generated',
      'openapi/generated',
    ]);
  });
});
