import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createOperationAccountingReport, renderGeneratedJson } from './artifacts.ts';
import { generatedDocumentationEmitter } from './documentation-emitter.ts';
import { generatedExamplesEmitter } from './examples-emitter.ts';
import { namingReviewReportPath, renderNamingReviewReport } from './naming-review.ts';
import { normalizeOpenApiDocument } from './normalize.ts';
import { loadFacadeCatalog, resolveOperationMetadata } from './operation-metadata.ts';
import type { ResolvedOperationMetadata } from './operation-metadata.ts';
import type { EmitterContext, GenerationProvenance } from './orchestrate.ts';
import { generatedPaths, repositoryRoot } from './paths.ts';
import { generatedSourceEmitter } from './source-emitter.ts';
import { generatedTestsEmitter } from './test-emitter.ts';

export interface GenerationCheckResult {
  readonly compatibilityDate: string;
  readonly fileCount: number;
  readonly sha256: string;
}

interface PathSnapshotEntry {
  readonly kind: 'file' | 'directory';
  readonly content: string;
}

export const generationCheckTargets: readonly string[] = Object.freeze([
  ...generatedPaths.source,
  ...generatedPaths.documentation,
  ...generatedPaths.examples,
  ...generatedPaths.tests,
  ...generatedPaths.openapi,
]);

export async function checkGeneratedOutputs(
  root: string = repositoryRoot,
): Promise<GenerationCheckResult> {
  const projectRoot = resolve(root);
  const workspace = await mkdtemp(join(tmpdir(), 'esi-client-generate-check-'));

  try {
    const generatedDirectory = join(projectRoot, 'openapi/generated');
    const facadeCatalogPath = join(projectRoot, 'openapi/config/naming-overrides.json');
    const [snapshotSource, provenance, compatibilityDate, facadeCatalogSource] = await Promise.all([
      readFile(join(generatedDirectory, 'esi-openapi.json'), 'utf8'),
      readFile(join(generatedDirectory, 'provenance.json'), 'utf8').then(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- assertCommittedSnapshotProvenance validates this shape below
        (source) => JSON.parse(source) as GenerationProvenance,
      ),
      readFile(join(projectRoot, 'openapi/compatibility-date.txt'), 'utf8').then((value) =>
        value.trim(),
      ),
      readFile(facadeCatalogPath, 'utf8'),
    ]);
    const correctedDocument: Record<string, unknown> = JSON.parse(snapshotSource);
    const canonicalSnapshot = serializeJson(correctedDocument);
    assertCommittedSnapshotProvenance(provenance, compatibilityDate, canonicalSnapshot);

    const normalizedModel = await normalizeOpenApiDocument(correctedDocument, {
      exclusionsPath: join(projectRoot, 'openapi/config/exclusions.json'),
    });
    const [facadeCatalog, operationMetadata] = await Promise.all([
      loadFacadeCatalog(normalizedModel, facadeCatalogPath),
      resolveOperationMetadata(normalizedModel, {
        facadeCatalogPath,
        safetyOverridesPath: join(projectRoot, 'openapi/config/safety-overrides.json'),
      }),
    ]);
    const namingReviewReport = renderNamingReviewReport(normalizedModel, facadeCatalog, provenance);
    assertNamingProvenance(provenance, facadeCatalogSource, namingReviewReport);
    const context: EmitterContext = Object.freeze({
      compatibilityDate,
      correctedDocument,
      normalizedModel,
      namingReviewReport,
      operationMetadata,
      outputDirectory: workspace,
      outputPath: (target: string) => join(workspace, target),
      provenance,
    });

    for (const emitter of [
      generatedSourceEmitter,
      generatedDocumentationEmitter,
      generatedExamplesEmitter,
      generatedTestsEmitter,
    ]) {
      await emitter.emit(context);
    }
    await writeOpenApiOutputs(
      workspace,
      canonicalSnapshot,
      normalizedModel,
      operationMetadata,
      provenance,
    );

    const result = await compareGeneratedOutputs(workspace, projectRoot, generationCheckTargets);
    return { ...result, compatibilityDate, sha256: provenance.sha256 };
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

export async function compareGeneratedOutputs(
  stagedRoot: string,
  projectRoot: string,
  targets?: readonly string[],
): Promise<{ readonly fileCount: number }> {
  const checkedTargets = targets ?? generationCheckTargets;
  const [staged, committed] = await Promise.all([
    snapshotPaths(resolve(stagedRoot), checkedTargets),
    snapshotPaths(resolve(projectRoot), checkedTargets),
  ]);
  const allPaths = new Set([...staged.keys(), ...committed.keys()]);
  const drift: string[] = [];

  for (const path of [...allPaths].toSorted(compareText)) {
    const stagedEntry = staged.get(path);
    const committedEntry = committed.get(path);
    if (stagedEntry === undefined) drift.push(`unexpected committed path ${path}`);
    else if (committedEntry === undefined) drift.push(`missing committed path ${path}`);
    else if (stagedEntry.kind !== committedEntry.kind) drift.push(`path kind changed ${path}`);
    else if (stagedEntry.content !== committedEntry.content) drift.push(`content changed ${path}`);
  }

  if (drift.length > 0) {
    throw new Error(
      `Generated output is stale; run pnpm generate and review the result:\n${drift
        .map((entry) => `- ${entry}`)
        .join('\n')}`,
    );
  }
  return { fileCount: [...staged.values()].filter(({ kind }) => kind === 'file').length };
}

async function writeOpenApiOutputs(
  outputDirectory: string,
  snapshot: string,
  normalizedModel: EmitterContext['normalizedModel'],
  operationMetadata: readonly ResolvedOperationMetadata[],
  provenance: GenerationProvenance,
): Promise<void> {
  const directory = join(outputDirectory, 'openapi/generated');
  const accounting = createOperationAccountingReport(normalizedModel, operationMetadata);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'esi-openapi.json'), snapshot),
    writeFile(join(directory, 'normalized-model.json'), serializeJson(normalizedModel)),
    writeFile(
      join(directory, 'operation-accounting.json'),
      renderGeneratedJson(accounting, provenance),
    ),
    writeFile(join(directory, 'provenance.json'), serializeJson(provenance)),
  ]);
}

function assertCommittedSnapshotProvenance(
  provenance: GenerationProvenance,
  compatibilityDate: string,
  snapshot: string,
): void {
  const sha256 = createHash('sha256').update(snapshot).digest('hex');
  if (
    provenance === null ||
    typeof provenance !== 'object' ||
    provenance.compatibilityDate !== compatibilityDate ||
    provenance.sha256 !== sha256 ||
    !Array.isArray(provenance.appliedCorrections) ||
    typeof provenance.sourceSha256 !== 'string' ||
    typeof provenance.specificationUrl !== 'string'
  ) {
    throw new Error('Committed OpenAPI snapshot and provenance are inconsistent');
  }
}

function assertNamingProvenance(
  provenance: GenerationProvenance,
  facadeCatalogSource: string,
  namingReviewReport: string,
): void {
  if (
    provenance.facadeCatalog?.path !== 'openapi/config/naming-overrides.json' ||
    provenance.facadeCatalog?.sha256 !== hashText(facadeCatalogSource) ||
    provenance.facadeReviewReport?.path !== namingReviewReportPath ||
    provenance.facadeReviewReport?.sha256 !== hashText(namingReviewReport)
  ) {
    throw new Error(
      'Committed facade catalog, naming review report, and provenance are inconsistent',
    );
  }
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function snapshotPaths(
  root: string,
  targets: readonly string[],
): Promise<Map<string, PathSnapshotEntry>> {
  const snapshot = new Map<string, PathSnapshotEntry>();
  for (const target of targets) await snapshotPath(root, target, snapshot);
  return snapshot;
}

async function snapshotPath(
  root: string,
  repositoryPath: string,
  snapshot: Map<string, PathSnapshotEntry>,
): Promise<void> {
  const path = join(root, repositoryPath);
  let status;
  try {
    status = await lstat(path);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (status.isSymbolicLink()) {
    throw new Error(`Generated output must not contain symbolic links: ${repositoryPath}`);
  }
  if (status.isFile()) {
    snapshot.set(repositoryPath, { kind: 'file', content: await readFile(path, 'base64') });
    return;
  }
  if (!status.isDirectory()) {
    throw new Error(`Generated output must be a file or directory: ${repositoryPath}`);
  }

  snapshot.set(repositoryPath, { kind: 'directory', content: '' });
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => compareText(left.name, right.name))) {
    await snapshotPath(root, `${repositoryPath}/${entry.name}`, snapshot);
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const result = await checkGeneratedOutputs();
  process.stdout.write(
    `Generated output is current: ${result.fileCount} files for ESI ${result.compatibilityDate} (${result.sha256}).\n`,
  );
}
