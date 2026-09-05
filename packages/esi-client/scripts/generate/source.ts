import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applySpecificationCorrections } from './corrections.ts';
import { createOperationAccountingReport, renderGeneratedJson } from './artifacts.ts';
import { generatedDocumentationEmitter } from './documentation-emitter.ts';
import { generatedExamplesEmitter } from './examples-emitter.ts';
import { normalizeOpenApiDocument } from './normalize.ts';
import { namingReviewReportPath, renderNamingReviewReport } from './naming-review.ts';
import { defaultSpecificationUrl, stageOpenApiSnapshot } from './openapi.ts';
import type { StagedOpenApiSnapshot } from './openapi.ts';
import {
  defaultFacadeCatalogPath,
  loadFacadeCatalog,
  resolveOperationMetadata,
} from './operation-metadata.ts';
import { generatedPaths } from './paths.ts';
import { generatedSourceEmitter } from './source-emitter.ts';
import { generatedTestsEmitter } from './test-emitter.ts';
import type {
  EmitterContext,
  GeneratedOutputClaim,
  GeneratedOutputEmitter,
  GenerationProvenance,
} from './orchestrate.ts';

type SourceProvenance = Omit<GenerationProvenance, 'facadeCatalog' | 'facadeReviewReport'>;

interface CorrectedInput {
  readonly document: Record<string, unknown>;
  readonly provenance: SourceProvenance;
  readonly stagedSnapshot: StagedOpenApiSnapshot | undefined;
}

interface ReplacementTransactionEntry {
  readonly backup: string;
  backedUp: boolean;
  installed: boolean;
  readonly source: string;
  readonly target: string;
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const refreshSnapshotFlag = '--refresh-snapshot';
const commandArguments = process.argv.slice(2);
if (commandArguments.some((argument) => argument !== refreshSnapshotFlag)) {
  throw new Error(`Unknown source generation option: ${commandArguments.join(' ')}`);
}

const refreshSnapshot = commandArguments.includes(refreshSnapshotFlag);
const workspace = await mkdtemp(join(root, '.esi-source-generation-'));
let stagedSnapshot: StagedOpenApiSnapshot | undefined;
let generationError: unknown;

try {
  const input = refreshSnapshot
    ? await retrieveCorrectedInput(workspace)
    : await readCommittedCorrectedInput();
  stagedSnapshot = input.stagedSnapshot;

  const normalizedModel = await normalizeOpenApiDocument(input.document);
  const [facadeCatalogSource, facadeCatalog, operationMetadata] = await Promise.all([
    readFile(defaultFacadeCatalogPath, 'utf8'),
    loadFacadeCatalog(normalizedModel),
    resolveOperationMetadata(normalizedModel),
  ]);
  const provenanceWithoutReport = Object.freeze({
    appliedCorrections: input.provenance.appliedCorrections,
    compatibilityDate: input.provenance.compatibilityDate,
    facadeCatalog: {
      path: repositoryPath(defaultFacadeCatalogPath),
      sha256: hashText(facadeCatalogSource),
    },
    sha256: input.provenance.sha256,
    sourceSha256: input.provenance.sourceSha256,
    specificationUrl: input.provenance.specificationUrl,
  });
  const namingReviewReport = renderNamingReviewReport(
    normalizedModel,
    facadeCatalog,
    provenanceWithoutReport,
  );
  const provenance: GenerationProvenance = Object.freeze({
    ...provenanceWithoutReport,
    facadeReviewReport: {
      path: namingReviewReportPath,
      sha256: hashText(namingReviewReport),
    },
  });
  const context: EmitterContext = Object.freeze({
    compatibilityDate: provenance.compatibilityDate,
    correctedDocument: input.document,
    normalizedModel,
    namingReviewReport,
    operationMetadata,
    outputDirectory: workspace,
    outputPath: (target: string) => join(workspace, target),
    provenance,
  });

  const offlineTargets = await emitOfflineArtifacts(context);
  const replacements = offlineTargets.map((target) => ({
    source: join(workspace, target),
    target: join(root, target),
  }));
  await writeCommittedInputOutput(
    workspace,
    input.document,
    normalizedModel,
    operationMetadata,
    provenance,
  );
  replacements.push({
    source: join(workspace, 'openapi/generated'),
    target: join(root, 'openapi/generated'),
  });

  await replacePathsAtomically(replacements);
  process.stdout.write(
    `Generated source, documentation, examples, and OpenAPI artifacts for ESI compatibility date ${provenance.compatibilityDate} (${provenance.sha256}).\n`,
  );
} catch (error) {
  generationError = error;
}

const cleanupResults = await Promise.allSettled([
  stagedSnapshot?.cleanup(),
  rm(workspace, { force: true, recursive: true }),
]);
const cleanupErrors = cleanupResults
  .filter((result) => result.status === 'rejected')
  .map((result) => result.reason);
if (generationError !== undefined) {
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [generationError, ...cleanupErrors],
      'Source generation and cleanup failed',
      { cause: generationError },
    );
  }
  throw generationError;
}
if (cleanupErrors.length > 0) {
  throw new AggregateError(cleanupErrors, 'Source generation cleanup failed');
}

async function emitOfflineArtifacts(context: EmitterContext): Promise<string[]> {
  const targetKinds = new Map<string, 'file' | 'directory'>([
    ...generatedPaths.source.map((target) => [target, 'directory' as const] as const),
    ...generatedPaths.documentation.map(
      (target) => [target, documentationTargetKind(target)] as const,
    ),
    ...generatedPaths.examples.map((target) => [target, 'directory' as const] as const),
    ...generatedPaths.tests.map((target) => [target, 'directory' as const] as const),
  ]);
  const claims = new Map<string, 'file' | 'directory'>();
  const emitters: readonly GeneratedOutputEmitter[] = [
    generatedSourceEmitter,
    generatedDocumentationEmitter,
    generatedExamplesEmitter,
    generatedTestsEmitter,
  ];
  for (const emitter of emitters) {
    const emittedClaims = await emitter.emit(context);
    for (const claim of emittedClaims) {
      const expectedKind = targetKinds.get(claim.target);
      await validateOfflineClaim(context, emitter, claim, expectedKind, claims);
      claims.set(claim.target, claim.kind);
    }
  }
  const missing = [...targetKinds.keys()].filter((target) => !claims.has(target));
  if (missing.length > 0) {
    throw new Error(`Missing offline generated output claims: ${missing.join(', ')}`);
  }
  return [...targetKinds.keys()];
}

function documentationTargetKind(target: string): 'file' | 'directory' {
  return target.endsWith('.txt') ? 'file' : 'directory';
}

async function validateOfflineClaim(
  context: EmitterContext,
  emitter: GeneratedOutputEmitter,
  claim: GeneratedOutputClaim,
  expectedKind: 'file' | 'directory' | undefined,
  claims: ReadonlyMap<string, 'file' | 'directory'>,
): Promise<void> {
  if (expectedKind === undefined) {
    throw new Error(`Offline emitter ${emitter.name} claimed unexpected target: ${claim.target}`);
  }
  if (claims.has(claim.target)) {
    throw new Error(`Duplicate offline generated output claim: ${claim.target}`);
  }
  if (claim.kind !== expectedKind) {
    throw new Error(
      `Offline generated output ${claim.target} must be a ${expectedKind}, not a ${claim.kind}`,
    );
  }
  const status = await lstat(join(context.outputDirectory, claim.target));
  if (
    status.isSymbolicLink() ||
    (claim.kind === 'file' ? !status.isFile() : !status.isDirectory())
  ) {
    throw new Error(`Offline generated output has the wrong filesystem type: ${claim.target}`);
  }
}

async function readCommittedCorrectedInput(): Promise<CorrectedInput> {
  const directory = join(root, 'openapi/generated');
  let source: string;
  let provenance: SourceProvenance;
  try {
    [source, provenance] = await Promise.all([
      readFile(join(directory, 'esi-openapi.json'), 'utf8'),
      readFile(join(directory, 'provenance.json'), 'utf8').then(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- assertProvenance validates this shape below
        (text) => JSON.parse(text) as SourceProvenance,
      ),
    ]);
  } catch (error) {
    throw new Error(
      `Missing corrected pinned snapshot; run pnpm generate:source:refresh once (${directory})`,
      { cause: error },
    );
  }

  const document: Record<string, unknown> = JSON.parse(source);
  assertProvenance(provenance);
  const compatibilityDate = (
    await readFile(join(root, 'openapi/compatibility-date.txt'), 'utf8')
  ).trim();
  if (provenance.compatibilityDate !== compatibilityDate) {
    throw new Error(
      `Pinned snapshot date ${provenance.compatibilityDate} does not match ${compatibilityDate}`,
    );
  }
  const sha256 = createHash('sha256').update(serializeJson(document)).digest('hex');
  if (sha256 !== provenance.sha256) {
    throw new Error(
      `Pinned corrected snapshot hash mismatch: expected ${provenance.sha256}, got ${sha256}`,
    );
  }
  return { document, provenance, stagedSnapshot: undefined };
}

async function retrieveCorrectedInput(workspaceDirectory: string): Promise<CorrectedInput> {
  const staged = await stageOpenApiSnapshot({ temporaryRoot: workspaceDirectory });
  const corrected = await applySpecificationCorrections(staged.document, staged.compatibilityDate);
  const snapshot = serializeJson(corrected.document);
  const provenance: SourceProvenance = Object.freeze({
    appliedCorrections: corrected.appliedCorrections,
    compatibilityDate: staged.compatibilityDate,
    sha256: createHash('sha256').update(snapshot).digest('hex'),
    sourceSha256: staged.sha256,
    specificationUrl: defaultSpecificationUrl,
  });
  return { document: corrected.document, provenance, stagedSnapshot: staged };
}

async function writeCommittedInputOutput(
  workspaceDirectory: string,
  document: Record<string, unknown>,
  normalizedModel: EmitterContext['normalizedModel'],
  operationMetadata: EmitterContext['operationMetadata'],
  provenance: GenerationProvenance,
): Promise<void> {
  const directory = join(workspaceDirectory, 'openapi/generated');
  const accounting = createOperationAccountingReport(normalizedModel, operationMetadata);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'esi-openapi.json'), serializeJson(document)),
    writeFile(join(directory, 'normalized-model.json'), serializeJson(normalizedModel)),
    writeFile(
      join(directory, 'operation-accounting.json'),
      renderGeneratedJson(accounting, provenance),
    ),
    writeFile(join(directory, 'provenance.json'), serializeJson(provenance)),
  ]);
}

async function replacePathsAtomically(
  replacements: readonly { readonly source: string; readonly target: string }[],
): Promise<void> {
  const transaction: ReplacementTransactionEntry[] = replacements.map(({ source, target }) => ({
    backup: `${target}.backup-${randomUUID()}`,
    backedUp: false,
    installed: false,
    source,
    target,
  }));

  try {
    for (const entry of transaction) {
      await installReplacement(entry);
    }
  } catch (error) {
    await rollbackReplacements(transaction, error);
  }

  await Promise.all(
    transaction.map(({ backup, backedUp }) =>
      backedUp ? rm(backup, { force: true, recursive: true }) : Promise.resolve(),
    ),
  );
}

async function installReplacement(entry: ReplacementTransactionEntry): Promise<void> {
  await mkdir(join(entry.target, '..'), { recursive: true });
  if (await pathExists(entry.target)) {
    await rename(entry.target, entry.backup);
    entry.backedUp = true;
  }
  await rename(entry.source, entry.target);
  entry.installed = true;
}

async function rollbackReplacements(
  transaction: readonly ReplacementTransactionEntry[],
  error: unknown,
): Promise<void> {
  const rollbackErrors: unknown[] = [];
  for (const entry of transaction.toReversed()) {
    try {
      if (entry.installed) await rm(entry.target, { force: true, recursive: true });
      if (entry.backedUp) await rename(entry.backup, entry.target);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError([error, ...rollbackErrors], 'Source generation replacement failed', {
      cause: error,
    });
  }
  throw error;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertProvenance(value: unknown): asserts value is SourceProvenance {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid pinned corrected snapshot provenance');
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typeof narrows to object, not an indexable record
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.appliedCorrections) ||
    typeof record.compatibilityDate !== 'string' ||
    typeof record.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(record.sha256) ||
    typeof record.sourceSha256 !== 'string' ||
    typeof record.specificationUrl !== 'string'
  ) {
    throw new Error('Invalid pinned corrected snapshot provenance');
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function repositoryPath(path: string): string {
  return relative(root, path).replaceAll('\\', '/');
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
