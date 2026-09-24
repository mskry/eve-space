import { describe, expect, it } from 'vitest';

import {
  createPackageBudgetBaseline,
  findForbiddenPackedPaths,
  forbiddenPackagePaths,
  measurePackedPackage,
  packageBudgetSchemaVersion,
  tracePackedArtifactGraph,
  validateDomainDeclarationSurface,
  validateDomainEntryIsolation,
  validatePackageBudgets,
  validatePackedArtifactIntegrity,
  validatePackedPackageBoundary,
} from '../scripts/lib/package-inspection.ts';

const packageJson = {
  exports: {
    './operations': {
      import: './dist/operations/index.js',
      types: './dist/operations/index.d.ts',
    },
    './package.json': './package.json',
  },
};
const runtimeFiles = [
  { path: 'package.json' },
  { path: 'dist/operations/index.d.ts' },
  { path: 'dist/operations/index.js' },
];

const budgetPackageJson = {
  exports: {
    '.': { import: './dist/root.js', types: './dist/root.d.ts' },
    './operations': {
      import: './dist/operations/index.js',
      types: './dist/operations/index.d.ts',
    },
    './package.json': './package.json',
  },
  version: '2.0.0',
};
const packedPackage = {
  entryCount: 8,
  files: [
    { path: 'LICENSE', size: 100 },
    { path: 'README.md', size: 200 },
    { path: 'package.json', size: 300 },
    { path: 'dist/root.js', size: 400, source: '' },
    { path: 'dist/root.d.ts', size: 500, source: '' },
    { path: 'dist/operations/index.js', size: 600, source: '' },
    { path: 'dist/operations/index.d.ts', size: 700, source: '' },
    { path: 'dist/shared.js', size: 100 },
  ],
  size: 500,
  unpackedSize: 2000,
};

function budgetFixture() {
  const measurements = measurePackedPackage(structuredClone(packedPackage), budgetPackageJson);
  return { baseline: createPackageBudgetBaseline(measurements), measurements };
}

describe('npm package documentation boundary', () => {
  it('enumerates every forbidden generated documentation and example path', () => {
    const files = [
      ...runtimeFiles,
      { path: 'llms.txt' },
      { path: 'docs/llms.txt' },
      { path: 'docs/generated/operations/GetStatus.md' },
      { path: 'examples/generated/public.ts' },
      { path: 'openapi/config/naming-overrides.json' },
    ];

    expect(forbiddenPackagePaths).toStrictEqual([
      'llms.txt',
      'docs/llms.txt',
      'docs/generated/',
      'examples/generated/',
      'openapi/config/',
    ]);
    expect(findForbiddenPackedPaths(files)).toStrictEqual([
      'docs/generated/operations/GetStatus.md',
      'docs/llms.txt',
      'examples/generated/public.ts',
      'llms.txt',
      'openapi/config/naming-overrides.json',
    ]);
    expect(() => validatePackedPackageBoundary(files, packageJson)).toThrow(
      'docs/generated/operations/GetStatus.md, docs/llms.txt, examples/generated/public.ts, llms.txt, openapi/config/naming-overrides.json',
    );
  });

  it('requires packed runtime operation metadata export targets', () => {
    expect(validatePackedPackageBoundary(runtimeFiles, packageJson)).toStrictEqual({
      forbiddenPaths: [],
      operationExportTargets: ['dist/operations/index.d.ts', 'dist/operations/index.js'],
    });
    expect(() => validatePackedPackageBoundary(runtimeFiles, { exports: {} })).toThrow(
      'must export runtime operation metadata through ./operations',
    );
    expect(() => validatePackedPackageBoundary(runtimeFiles.slice(0, 2), packageJson)).toThrow(
      'Packed ./operations export targets are missing: dist/operations/index.js',
    );
    expect(() =>
      validatePackedPackageBoundary(runtimeFiles, {
        exports: { './operations': packageJson.exports['./operations'] },
      }),
    ).toThrow('must export ./package.json as package metadata');
  });
});

describe('npm package budgets', () => {
  it('records tight aggregate and per-public-entry budgets with explicit packed files', () => {
    const { measurements, baseline } = budgetFixture();

    expect(measurements.totals).toStrictEqual({
      compressedBytes: 500,
      declarationBytes: 1200,
      fileCount: 8,
      javascriptBytes: 1100,
      unpackedBytes: 2000,
    });
    expect(packageBudgetSchemaVersion).toBe(2);
    expect(baseline.schemaVersion).toBe(2);
    expect(baseline.policy).toStrictEqual({
      byteHeadroomPercent: 2,
      description:
        'Byte maxima are accepted unique transitive measurements plus 2%; reachable files, external edges, file count, and packed paths have no headroom, so every graph or artifact change requires review.',
      fileCountHeadroom: 0,
    });
    expect(baseline.totals.compressedBytes).toStrictEqual({ maximum: 510, measured: 500 });
    expect(baseline.totals.fileCount).toStrictEqual({ maximum: 8, measured: 8 });
    expect(baseline.publicEntries['.'].runtime).toStrictEqual({
      externalEdges: [],
      files: ['dist/root.js'],
      maximumUniqueBytes: 408,
      measuredUniqueBytes: 400,
      target: 'dist/root.js',
    });
    expect(() => validatePackageBudgets(measurements, baseline)).not.toThrow();
    const nextVersion = structuredClone(measurements);
    nextVersion.packageVersion = '2.1.0';
    expect(() => validatePackageBudgets(nextVersion, baseline)).not.toThrow();
  });

  it.each([
    ['compressedBytes', 'compressedBytes'],
    ['unpackedBytes', 'unpackedBytes'],
    ['javascriptBytes', 'javascriptBytes'],
    ['declarationBytes', 'declarationBytes'],
    ['fileCount', 'fileCount'],
  ] as const)(
    'rejects aggregate %s growth',
    (
      metric:
        | 'compressedBytes'
        | 'unpackedBytes'
        | 'javascriptBytes'
        | 'declarationBytes'
        | 'fileCount',
      message: string,
    ) => {
      const { measurements, baseline } = budgetFixture();
      const changed = structuredClone(measurements);
      changed.totals[metric] = baseline.totals[metric].maximum + 1;

      expect(() => validatePackageBudgets(changed, baseline)).toThrow(
        `${message} is ${changed.totals[metric]}, exceeding budget`,
      );
    },
  );

  it.each([
    ['runtime', 'runtime'],
    ['declaration', 'declaration'],
  ] as const)('rejects per-entry %s growth', (kind: 'runtime' | 'declaration', message: string) => {
    const { measurements, baseline } = budgetFixture();
    const changed = structuredClone(measurements);
    changed.publicEntries['.'][kind].uniqueBytes =
      baseline.publicEntries['.'][kind].maximumUniqueBytes + 1;

    expect(() => validatePackageBudgets(changed, baseline)).toThrow(
      `public entry . ${message} is ${changed.publicEntries['.'][kind].uniqueBytes} unique bytes, exceeding budget`,
    );
  });

  it('rejects missing, stale, and newly exported public-entry budgets', () => {
    const { measurements, baseline } = budgetFixture();
    const missing = structuredClone(baseline);
    delete missing.publicEntries['./operations'];
    expect(() => validatePackageBudgets(measurements, missing)).toThrow(
      'public entry budgets missing: ./operations',
    );

    const stale = structuredClone(baseline);
    stale.publicEntries['./stale'] = structuredClone(stale.publicEntries['.']);
    expect(() => validatePackageBudgets(measurements, stale)).toThrow(
      'public entry budgets stale or unexpected: ./stale',
    );

    const addedExport = structuredClone(measurements);
    addedExport.publicEntries['./new'] = structuredClone(addedExport.publicEntries['.']);
    expect(() => validatePackageBudgets(addedExport, baseline)).toThrow(
      'public entry budgets missing: ./new',
    );
  });

  it('rejects unexplained new chunks and stale allowed files', () => {
    const { measurements, baseline } = budgetFixture();
    const newChunk = structuredClone(measurements);
    newChunk.files.push('dist/new-shared.js');
    expect(() => validatePackageBudgets(newChunk, baseline)).toThrow(
      'packed files stale or unexpected: dist/new-shared.js',
    );

    const missingChunk = structuredClone(measurements);
    missingChunk.files = missingChunk.files.filter((path) => path !== 'dist/shared.js');
    expect(() => validatePackageBudgets(missingChunk, baseline)).toThrow(
      'packed files missing: dist/shared.js',
    );
  });

  it('rejects changed reachable files and external edges even within byte maxima', () => {
    const { measurements, baseline } = budgetFixture();
    const changed = structuredClone(measurements);
    changed.publicEntries['.'].runtime.files.push('dist/shared.js');
    changed.publicEntries['.'].runtime.externalEdges.push({
      from: 'dist/root.js',
      specifier: 'zod',
    });

    expect(() => validatePackageBudgets(changed, baseline)).toThrow(
      'public entry . runtime reachable files stale or unexpected: dist/shared.js',
    );
    expect(() => validatePackageBudgets(changed, baseline)).toThrow(
      'public entry . runtime external edges stale or unexpected: dist/root.js -> zod',
    );
  });
});

describe('packed artifact graph tracing', () => {
  it('rejects raw source trees and generated Hey API client artifacts', () => {
    for (const path of [
      'src/index.ts',
      'dist/src/index.js',
      'dist/generated/types.js',
      'dist/sdk.gen.js',
      'dist/client.gen.d.ts',
    ]) {
      expect(() => validatePackedArtifactIntegrity([{ path, size: 0 }], {})).toThrow(
        'Packed source or generated client artifacts are forbidden',
      );
    }
  });

  it.each([
    ['//#region src/generated/sdk.gen.ts', 'generated Hey API SDK/client source marker'],
    ["import '@hey-api/openapi-ts';", 'generator package reference'],
    ["import '@evespace/esi-client-codegen';", 'generator package reference'],
    ["export const generatedAt = '2026-09-05T12:34:56.000Z';", 'generation timestamp'],
    [
      "export const source = '/var/folders/ab/generation/output.ts';",
      'absolute or temporary machine path',
    ],
  ])('rejects packed artifact content %j', (source, expected) => {
    expect(() =>
      validatePackedArtifactIntegrity(
        [{ path: 'dist/orphan.js', size: Buffer.byteLength(source), source }],
        {},
      ),
    ).toThrow(expected);
  });

  it('validates imports in orphaned packed artifacts', () => {
    const files = graphFiles({
      'dist/orphan.js': "import 'left-pad';",
      'dist/root.js': '',
    });

    expect(() => validatePackedArtifactIntegrity(files, {})).toThrow(
      'undeclared external edge from dist/orphan.js: left-pad',
    );
    const orphan = files.find(({ path }) => path === 'dist/orphan.js');
    if (!orphan) {
      throw new Error('Orphan artifact was not created');
    }
    orphan.source = "import 'zod';";
    expect(
      validatePackedArtifactIntegrity(files, { peerDependencies: { zod: '^4.0.0' } }),
    ).toStrictEqual({
      analyzedArtifactCount: 2,
    });
  });

  it('traces cycles, normalized duplicate paths, re-exports, and literal dynamic imports once', () => {
    const files = graphFiles({
      'dist/a.js': 'import "./b.js";',
      'dist/b.js': 'export * from "./a.js";',
      'dist/lazy.js': 'import "./b.js";',
      'dist/root.js': [
        'import "./a.js";',
        'import "./nested/../a.js";',
        'export * from "./b.js";',
        'void import("./lazy.js");',
      ].join('\n'),
    });

    expect(tracePackedArtifactGraph(files, './dist/root.js', 'runtime')).toStrictEqual({
      externalEdges: [],
      files: ['dist/a.js', 'dist/b.js', 'dist/lazy.js', 'dist/root.js'],
      target: 'dist/root.js',
      uniqueBytes: files.reduce((total, file) => total + file.size, 0),
    });
  });

  it('traces declaration imports, type re-exports, inline import types, and approved peers', () => {
    const files = graphFiles({
      'dist/dynamic.d.ts': 'export interface C { readonly value: string }',
      'dist/re-export.d.ts': 'export type { A as B } from "./types.js";',
      'dist/root.d.ts': [
        'import type { A } from "./types.js";',
        'export type { B } from "./re-export.js";',
        'export type C = import("./dynamic.js").C;',
      ].join('\n'),
      'dist/types.d.ts': 'import type { z } from "zod"; export type A = z.ZodType;',
    });

    expect(tracePackedArtifactGraph(files, 'dist/root.d.ts', 'declaration', ['zod'])).toStrictEqual(
      {
        externalEdges: [{ from: 'dist/types.d.ts', specifier: 'zod' }],
        files: ['dist/dynamic.d.ts', 'dist/re-export.d.ts', 'dist/root.d.ts', 'dist/types.d.ts'],
        target: 'dist/root.d.ts',
        uniqueBytes: files.reduce((total, file) => total + file.size, 0),
      },
    );
  });

  it('rejects duplicate packed paths and missing relative targets', () => {
    const duplicate = graphFiles({ 'dist/root.js': '' });
    duplicate.push({ ...duplicate[0] });
    expect(() => tracePackedArtifactGraph(duplicate, 'dist/root.js', 'runtime')).toThrow(
      'duplicate paths: dist/root.js',
    );

    expect(() =>
      tracePackedArtifactGraph(
        graphFiles({ 'dist/root.js': 'import "./missing.js";' }),
        'dist/root.js',
        'runtime',
      ),
    ).toThrow('is missing its target: ./missing.js');
  });

  it('rejects escaping, unsupported, nonliteral dynamic, and undeclared external edges', () => {
    expect(() =>
      tracePackedArtifactGraph(
        graphFiles({ 'dist/root.js': 'export * from "../../outside.js";' }),
        'dist/root.js',
        'runtime',
      ),
    ).toThrow('edge escapes the package');
    expect(() =>
      tracePackedArtifactGraph(
        graphFiles({ 'dist/root.js': 'import "/absolute.js";' }),
        'dist/root.js',
        'runtime',
      ),
    ).toThrow('unsupported edge');
    expect(() =>
      tracePackedArtifactGraph(
        graphFiles({ 'dist/root.js': 'require("./dependency.js");' }),
        'dist/root.js',
        'runtime',
      ),
    ).toThrow('unsupported require syntax');
    expect(() =>
      tracePackedArtifactGraph(
        graphFiles({ 'dist/root.js': 'const path = "./lazy.js"; void import(path);' }),
        'dist/root.js',
        'runtime',
      ),
    ).toThrow('nonliteral dynamic import');
    expect(() =>
      tracePackedArtifactGraph(
        graphFiles({ 'dist/root.js': 'import "left-pad";' }),
        'dist/root.js',
        'runtime',
      ),
    ).toThrow('undeclared external edge from dist/root.js: left-pad');
  });

  it('rejects root, operation-discovery, and unrelated domain artifacts', () => {
    const isolated = {
      files: [],
      packageVersion: '2.0.0',
      publicEntries: {
        './domains/status': graphMeasurement('status'),
        './domains/wars': graphMeasurement('wars'),
      },
      totals: {},
    };
    expect(validateDomainEntryIsolation(isolated, 2)).toStrictEqual({ domainEntryCount: 2 });

    isolated.publicEntries['./domains/status'].runtime.files.push(
      'dist/root.js',
      'dist/operations.js',
      'dist/index.js',
      'dist/wars3.js',
    );
    expect(() => validateDomainEntryIsolation(isolated, 2)).toThrow('aggregate root');
    expect(() => validateDomainEntryIsolation(isolated, 2)).toThrow('global operation discovery');
    expect(() => validateDomainEntryIsolation(isolated, 2)).toThrow(
      'aggregate operation registry or discovery',
    );
    expect(() => validateDomainEntryIsolation(isolated, 2)).toThrow(
      'unrelated wars implementation or operation schema',
    );
  });

  it('rejects internal configuration types from every domain declaration closure', () => {
    const measurements = {
      files: [],
      packageVersion: '2.0.0',
      publicEntries: {
        './domains/status': graphMeasurement('status'),
      },
      totals: {},
    };
    const files = graphFiles({
      'dist/domains/status.d.ts': 'export { StatusDomainClient } from "../status.js";',
      'dist/status.d.ts': 'export declare abstract class StatusDomainClient {}',
      'dist/status2.d.ts': 'export interface GetStatusOptions {}',
    });
    measurements.publicEntries['./domains/status'].declaration.files = Object.keys(
      Object.fromEntries(files.map((file) => [file.path, true])),
    );

    expect(validateDomainDeclarationSurface(measurements, files, 1)).toStrictEqual({
      domainEntryCount: 1,
    });
    files[2].source = 'export declare class EsiClientConfiguration {}';
    expect(() => validateDomainDeclarationSurface(measurements, files, 1)).toThrow(
      'reaches internal EsiClientConfiguration',
    );
  });
});

function graphFiles(sources: Record<string, string>) {
  return Object.entries(sources).map(([path, source]) => ({
    path,
    size: Buffer.byteLength(source),
    source,
  }));
}

function graphMeasurement(domain: string) {
  const runtime = {
    externalEdges: [],
    files: [`dist/domains/${domain}.js`, `dist/${domain}.js`, `dist/${domain}2.js`],
    target: `dist/domains/${domain}.js`,
    uniqueBytes: 1,
  };
  return {
    declaration: {
      ...structuredClone(runtime),
      files: [`dist/domains/${domain}.d.ts`, `dist/${domain}.d.ts`, `dist/${domain}2.d.ts`],
      target: `dist/domains/${domain}.d.ts`,
    },
    runtime,
  };
}
