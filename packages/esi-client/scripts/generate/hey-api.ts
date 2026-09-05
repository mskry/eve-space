import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';

import { generateHeyApiArtifacts } from '@evespace/esi-client-codegen';
import { transform } from 'esbuild';

import { normalizeOpenApiDocument } from './normalize.ts';
import type { NormalizedOpenApiModel, NormalizedSuccessResponse } from './normalize.ts';
import { isTransportManagedParameter } from './operation-parameters.ts';
import { normalizeGeneratedPath, repositoryRoot } from './paths.ts';
import type { EmitterContext } from './generation-contracts.ts';
import type { GeneratedSourceComponent } from './source-emitter.ts';
import { isObject } from './internal/guards.ts';
import { compareText } from './internal/text.ts';

export interface HeyApiShadowGenerationOptions {
  readonly correctedDocument?: Readonly<Record<string, unknown>>;
}

export interface HeyApiShadowGenerationResult {
  readonly fileCount: number;
  readonly operationAccounting: {
    readonly generated: number;
    readonly reviewedExcluded: number;
    readonly source: number;
  };
  readonly paths: readonly string[];
  readonly sha256: string;
  readonly temporaryDirectories: readonly [string, string];
}

interface GeneratedArtifactSnapshot {
  readonly files: ReadonlyMap<string, Buffer>;
  readonly temporaryDirectory: string;
}

const executeFile = promisify(execFile);
const generatedArtifactPaths = Object.freeze(['index.ts', 'types.gen.ts', 'zod.gen.ts']);
export const correctedOpenApiSnapshotPath = join(
  repositoryRoot,
  'openapi/generated/esi-openapi.json',
);
const expectedNaturalTypeSymbols = Object.freeze([
  'GetStatusData',
  'GetStatusResponse',
  'GetStatusResponses',
  'Status',
]);
const expectedNaturalZodSymbols = Object.freeze(['zGetStatusResponse', 'zStatus']);

export async function checkHeyApiShadowGeneration(
  options: HeyApiShadowGenerationOptions = {},
): Promise<HeyApiShadowGenerationResult> {
  const document =
    options.correctedDocument === undefined
      ? await readCorrectedDocument(correctedOpenApiSnapshotPath)
      : cloneDocument(options.correctedDocument);
  const normalizedModel = await normalizeOpenApiDocument(cloneDocument(document), {
    exclusionsPath: join(repositoryRoot, 'openapi/config/exclusions.json'),
  });
  assertCompleteOperationAccounting(normalizedModel);
  assertSuccessResponseSchemas(normalizedModel);

  const first = await generateArtifactSnapshot(
    options.correctedDocument === undefined ? undefined : document,
  );
  const second = await generateArtifactSnapshot(
    options.correctedDocument === undefined ? undefined : document,
  );
  assertDeterministicSnapshots(first.files, second.files);
  validateGeneratedArtifacts(second.files, normalizedModel);
  const temporaryDirectories: [string, string] = [
    first.temporaryDirectory,
    second.temporaryDirectory,
  ];

  return Object.freeze({
    fileCount: second.files.size,
    operationAccounting: Object.freeze({
      generated: normalizedModel.accounting.normalizedOperationIds.length,
      reviewedExcluded: normalizedModel.accounting.excludedOperationIds.length,
      source: normalizedModel.accounting.sourceOperationIds.length,
    }),
    paths: Object.freeze([...second.files.keys()]),
    sha256: hashSnapshot(second.files),
    temporaryDirectories: Object.freeze(temporaryDirectories),
  });
}

export function assertSuccessResponseSchemas(model: NormalizedOpenApiModel): void {
  for (const operation of model.operations) {
    const jsonSchemas = new Set<string>();
    for (const response of operation.successResponses) {
      collectJsonSuccessResponseSchemas(operation.operationId, response, jsonSchemas);
    }
    if (jsonSchemas.size > 1) {
      throw new Error(
        `Operation ${operation.operationId} has multiple distinct JSON success schemas`,
      );
    }
  }
}

function collectJsonSuccessResponseSchemas(
  operationId: string,
  response: NormalizedSuccessResponse,
  jsonSchemas: Set<string>,
): void {
  if (response.status === '204' || response.status === '205') {
    if (!response.noContent || response.content.length > 0) {
      throw new Error(`No-content response ${operationId} ${response.status} declares content`);
    }
    return;
  }
  for (const content of response.content) {
    if (isJsonMediaType(content.mediaType)) {
      jsonSchemas.add(canonicalJson(content.schema));
    }
  }
}

export async function emitHeyApiSource(
  context: EmitterContext,
  sourceDirectory: string,
): Promise<readonly ['types.gen.ts', 'zod.gen.d.ts', 'zod.gen.js']> {
  const temporaryDirectory = join(sourceDirectory, '.hey-api');
  try {
    await generateHeyApiArtifacts({
      input: context.correctedDocument,
      outputDirectory: temporaryDirectory,
    });
    const zodPath = join(temporaryDirectory, 'zod.gen.ts');
    const zodSource = await readFile(zodPath, 'utf8');
    const [zodJavaScript, zodDeclaration] = await Promise.all([
      transform(zodSource, {
        format: 'esm',
        legalComments: 'none',
        loader: 'ts',
        target: 'es2022',
      }),
      emitDeclaration(zodPath),
    ]);
    await Promise.all([
      rename(join(temporaryDirectory, 'types.gen.ts'), join(sourceDirectory, 'types.gen.ts')),
      writeFile(join(sourceDirectory, 'zod.gen.d.ts'), zodDeclaration),
      writeFile(join(sourceDirectory, 'zod.gen.js'), zodJavaScript.code),
    ]);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
  return ['types.gen.ts', 'zod.gen.d.ts', 'zod.gen.js'];
}

export function createDeclarationCompilerArguments(
  sourcePath: string,
  outputDirectory: string,
): readonly string[] {
  return [
    sourcePath,
    '--ignoreConfig',
    '--declaration',
    '--emitDeclarationOnly',
    '--skipLibCheck',
    '--strict',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--newLine',
    'lf',
    '--outDir',
    outputDirectory,
  ];
}

export const heyApiSourceComponent: GeneratedSourceComponent = Object.freeze({
  name: 'hey-api',
  emit: emitHeyApiSource,
});

async function emitDeclaration(sourcePath: string): Promise<string> {
  // Staged under node_modules rather than the package root: tsc must resolve `zod` by walking up
  // from the emitted file, which a system temp directory cannot do, but generate:check must not
  // write inside the tracked worktree.
  const workspace = await mkdtemp(join(repositoryRoot, 'node_modules', '.esi-zod-declaration-'));
  const inputPath = join(workspace, 'zod.gen.ts');
  const outputDirectory = join(workspace, 'output');
  try {
    await writeFile(inputPath, await readFile(sourcePath));
    await executeFile(
      process.execPath,
      [
        join(repositoryRoot, 'node_modules/typescript/bin/tsc'),
        ...createDeclarationCompilerArguments(inputPath, outputDirectory),
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return await readFile(join(outputDirectory, 'zod.gen.d.ts'), 'utf8');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (!isObject(current)) return current;
    return Object.fromEntries(
      Object.entries(current).toSorted(([left], [right]) => compareText(left, right)),
    );
  });
}

function isJsonMediaType(mediaType: string): boolean {
  return /^application\/(?:[A-Z0-9!#$&^_.+-]+\+)?json(?:\s*;.*)?$/iu.test(mediaType);
}

async function generateArtifactSnapshot(
  correctedDocument?: Readonly<Record<string, unknown>>,
): Promise<GeneratedArtifactSnapshot> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'esi-client-hey-api-shadow-'));
  const outputDirectory = join(temporaryDirectory, 'output');

  try {
    await generateHeyApiArtifacts({
      input:
        correctedDocument === undefined
          ? correctedOpenApiSnapshotPath
          : cloneDocument(correctedDocument),
      outputDirectory,
    });

    return {
      files: await snapshotDirectory(outputDirectory),
      temporaryDirectory,
    };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function snapshotDirectory(directory: string): Promise<ReadonlyMap<string, Buffer>> {
  const files = new Map<string, Buffer>();
  await snapshotDirectoryEntries(directory, directory, files);
  return files;
}

async function snapshotDirectoryEntries(
  root: string,
  directory: string,
  files: Map<string, Buffer>,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => compareText(left.name, right.name))) {
    const path = join(directory, entry.name);
    const repositoryPath = normalizeGeneratedPath(relative(root, path));
    if (entry.isSymbolicLink()) {
      throw new Error(`Hey API shadow output must not contain symbolic links: ${repositoryPath}`);
    }
    if (entry.isDirectory()) {
      await snapshotDirectoryEntries(root, path, files);
    } else if (entry.isFile()) {
      files.set(repositoryPath, await readFile(path));
    } else {
      throw new Error(`Hey API shadow output must contain only files: ${repositoryPath}`);
    }
  }
}

function assertDeterministicSnapshots(
  first: ReadonlyMap<string, Buffer>,
  second: ReadonlyMap<string, Buffer>,
): void {
  const allPaths = new Set([...first.keys(), ...second.keys()]);
  const differences: string[] = [];
  for (const path of [...allPaths].toSorted(compareText)) {
    const firstContent = first.get(path);
    const secondContent = second.get(path);
    if (firstContent === undefined) differences.push(`only second run emitted ${path}`);
    else if (secondContent === undefined) differences.push(`only first run emitted ${path}`);
    else if (!firstContent.equals(secondContent)) differences.push(`bytes changed for ${path}`);
  }
  if (differences.length > 0) {
    throw new Error(`Hey API shadow generation is not deterministic:\n${formatList(differences)}`);
  }
}

function validateGeneratedArtifacts(
  files: ReadonlyMap<string, Buffer>,
  normalizedModel: NormalizedOpenApiModel,
): void {
  const paths = [...files.keys()];
  if (
    paths.length !== generatedArtifactPaths.length ||
    paths.some((path, index) => path !== generatedArtifactPaths[index])
  ) {
    throw new Error(
      `Hey API shadow generation emitted an unexpected path set: ${paths.join(', ') || '(empty)'}`,
    );
  }

  const typesSource = requiredArtifact(files, 'types.gen.ts').toString('utf8');
  const zodSource = requiredArtifact(files, 'zod.gen.ts').toString('utf8');
  const typeSymbols = collectExportedSymbols(typesSource);
  const zodSymbols = collectExportedSymbols(zodSource);

  assertSymbols(typeSymbols, expectedNaturalTypeSymbols, 'natural TypeScript');
  assertSymbols(zodSymbols, expectedNaturalZodSymbols, 'natural Zod');

  for (const operationId of normalizedModel.accounting.sourceOperationIds) {
    assertSymbols(
      typeSymbols,
      [`${operationId}Data`, `${operationId}Responses`, `${operationId}Response`],
      `TypeScript operation ${operationId}`,
    );
    assertSymbols(zodSymbols, [`z${operationId}Response`], `Zod operation ${operationId}`);
  }

  for (const operation of normalizedModel.operations) {
    if (operation.requestBody !== null) {
      assertSymbols(
        zodSymbols,
        [`z${operation.operationId}Body`],
        `Zod operation ${operation.operationId}`,
      );
    }
    for (const [placement, suffix] of [
      ['header', 'Headers'],
      ['path', 'Path'],
      ['query', 'Query'],
    ] as const) {
      if (
        operation.parameters.some(
          (parameter) =>
            parameter.placement === placement && !isTransportManagedParameter(parameter),
        )
      ) {
        assertSymbols(
          zodSymbols,
          [`z${operation.operationId}${suffix}`],
          `Zod operation ${operation.operationId}`,
        );
      }
    }
  }

  for (const [path, content] of files) {
    if (content.includes("from '@hey-api/client-") || content.includes('from "@hey-api/client-')) {
      throw new Error(`Hey API shadow output contains a generated client import: ${path}`);
    }
  }
}

function assertCompleteOperationAccounting(model: NormalizedOpenApiModel): void {
  const source = new Set(model.accounting.sourceOperationIds);
  const generated = new Set(model.accounting.normalizedOperationIds);
  const excluded = new Set(model.accounting.excludedOperationIds);
  const duplicates = [...generated].filter((operationId) => excluded.has(operationId));
  const unaccounted = [...source].filter(
    (operationId) => !generated.has(operationId) && !excluded.has(operationId),
  );
  const unknown = [...generated, ...excluded].filter((operationId) => !source.has(operationId));
  if (
    source.size !== model.accounting.sourceOperationIds.length ||
    generated.size !== model.accounting.normalizedOperationIds.length ||
    excluded.size !== model.accounting.excludedOperationIds.length ||
    duplicates.length > 0 ||
    unaccounted.length > 0 ||
    unknown.length > 0
  ) {
    throw new Error(
      `Normalized operation accounting is incomplete:\n${formatList([
        ...duplicates.map((id) => `generated and excluded: ${id}`),
        ...unaccounted.map((id) => `unaccounted: ${id}`),
        ...unknown.map((id) => `not in source: ${id}`),
      ])}`,
    );
  }
}

function collectExportedSymbols(source: string): ReadonlySet<string> {
  return new Set(
    [...source.matchAll(/export (?:class|const|enum|interface|type) ([A-Za-z_$][\w$]*)/gu)].map(
      (match) => match[1],
    ),
  );
}

function assertSymbols(
  actual: ReadonlySet<string>,
  expected: readonly string[],
  description: string,
): void {
  const missing = expected.filter((symbol) => !actual.has(symbol));
  if (missing.length > 0) {
    throw new Error(`Hey API omitted ${description} symbols:\n${formatList(missing)}`);
  }
}

function requiredArtifact(files: ReadonlyMap<string, Buffer>, path: string): Buffer {
  const content = files.get(path);
  if (content === undefined) throw new Error(`Hey API shadow output is missing ${path}`);
  return content;
}

async function readCorrectedDocument(path: string): Promise<Record<string, unknown>> {
  const source = await readFile(path, 'utf8');
  const document: unknown = JSON.parse(source);
  assertDocument(document);
  return document;
}

function cloneDocument(document: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const clone: unknown = structuredClone(document);
  assertDocument(clone);
  return clone;
}

function assertDocument(document: unknown): asserts document is Record<string, unknown> {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('Corrected OpenAPI input must be an in-memory document object');
  }
}

function hashSnapshot(files: ReadonlyMap<string, Buffer>): string {
  const hash = createHash('sha256');
  for (const [path, content] of files) {
    hash.update(path);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? '- (none)' : values.map((value) => `- ${value}`).join('\n');
}
