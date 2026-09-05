import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  applySpecificationCorrections,
  type AppliedSpecificationCorrections,
  type SpecificationCorrectionOptions,
} from './corrections.ts';
import {
  createOperationAccountingReport,
  renderGeneratedJson,
  type OperationAccountingReport,
} from './artifacts.ts';
import { renderNamingReviewReport, namingReviewReportPath } from './naming-review.ts';
import { normalizeOpenApiDocument } from './normalize.ts';
import type { NormalizeOpenApiOptions, NormalizedOpenApiModel } from './normalize.ts';
import { defaultSpecificationUrl, stageOpenApiSnapshot } from './openapi.ts';
import type { StageOpenApiSnapshotOptions, StagedOpenApiSnapshot } from './openapi.ts';
import {
  defaultFacadeCatalogPath,
  loadFacadeCatalog,
  resolveOperationMetadata,
} from './operation-metadata.ts';
import type { OperationMetadataOptions, ResolvedOperationMetadata } from './operation-metadata.ts';
import { generatedReplacementTargets, repositoryRoot } from './paths.ts';

export type GeneratedOutputKind = 'file' | 'directory';
export type ReplacementPhase = 'backup' | 'install' | 'restore';

export interface GeneratedOutputClaim {
  readonly target: string;
  readonly kind: GeneratedOutputKind;
}

export interface GenerationProvenance {
  readonly appliedCorrections: readonly string[];
  readonly compatibilityDate: string;
  readonly sha256: string;
  readonly sourceSha256: string;
  readonly specificationUrl: string;
  readonly facadeCatalog: GenerationProvenanceArtifact;
  readonly facadeReviewReport: GenerationProvenanceArtifact;
}

export interface GenerationProvenanceArtifact {
  readonly path: string;
  readonly sha256: string;
}

export interface EmitterContext {
  readonly compatibilityDate: string;
  readonly correctedDocument: Readonly<Record<string, unknown>>;
  readonly normalizedModel: NormalizedOpenApiModel;
  readonly namingReviewReport: string;
  readonly operationMetadata: readonly ResolvedOperationMetadata[];
  readonly outputDirectory: string;
  readonly provenance: GenerationProvenance;
  outputPath(target: string): string;
}

export interface GeneratedOutputEmitter {
  readonly name: string;
  emit(context: EmitterContext): Promise<readonly GeneratedOutputClaim[]>;
}

export interface OrchestrationDependencies {
  stageOpenApiSnapshot?: (options?: StageOpenApiSnapshotOptions) => Promise<StagedOpenApiSnapshot>;
  applySpecificationCorrections?: (
    document: Readonly<Record<string, unknown>>,
    compatibilityDate: string,
    options?: SpecificationCorrectionOptions,
  ) => Promise<AppliedSpecificationCorrections<Readonly<Record<string, unknown>>>>;
  normalizeOpenApiDocument?: (
    document: Readonly<Record<string, unknown>>,
    options?: NormalizeOpenApiOptions,
  ) => Promise<NormalizedOpenApiModel>;
  materializePath?: (source: string, destination: string) => Promise<void>;
  replacePath?: (source: string, destination: string, phase: ReplacementPhase) => Promise<void>;
}

export interface OrchestrateGenerationOptions {
  emitters?: readonly GeneratedOutputEmitter[];
  projectRoot?: string;
  temporaryRoot?: string;
  openapi?: Omit<StageOpenApiSnapshotOptions, 'temporaryRoot'>;
  corrections?: SpecificationCorrectionOptions;
  normalization?: NormalizeOpenApiOptions;
  operationMetadata?: OperationMetadataOptions;
  dependencies?: OrchestrationDependencies;
}

export interface OrchestrationResult {
  readonly compatibilityDate: string;
  readonly replacedTargets: readonly string[];
  readonly sha256: string;
}

interface TransactionEntry {
  readonly backupPath: string;
  backedUp: boolean;
  readonly incomingPath: string;
  installed: boolean;
  readonly livePath: string;
}

interface ClaimedOutput extends GeneratedOutputClaim {
  readonly emitter: string;
}

const generatedTargetKinds = new Map([
  ['src/generated', 'directory'],
  ['llms.txt', 'file'],
  ['docs/generated', 'directory'],
  ['docs/llms.txt', 'file'],
  ['examples/generated', 'directory'],
  ['tests/generated', 'directory'],
  ['openapi/generated', 'directory'],
]);

export async function orchestrateGeneration(
  options: OrchestrateGenerationOptions = {},
): Promise<OrchestrationResult> {
  const projectRoot = resolve(options.projectRoot ?? repositoryRoot);
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  const dependencies = options.dependencies ?? {};
  const stageSnapshot = dependencies.stageOpenApiSnapshot ?? stageOpenApiSnapshot;
  const applyCorrections =
    dependencies.applySpecificationCorrections ?? applySpecificationCorrections;
  const normalizeDocument = dependencies.normalizeOpenApiDocument ?? normalizeOpenApiDocument;
  const materializePath = dependencies.materializePath ?? copyPath;
  const replacePath = dependencies.replacePath ?? renamePath;
  const transaction: TransactionEntry[] = [];
  let stagedSnapshot: StagedOpenApiSnapshot | undefined;
  let workspace: string | undefined;
  let result: OrchestrationResult | undefined;
  let failure: unknown;

  try {
    workspace = await mkdtemp(join(temporaryRoot, 'esi-client-generate-'));
    stagedSnapshot = await stageSnapshot({
      ...options.openapi,
      temporaryRoot: workspace,
    });
    const corrected = await applyCorrections(
      stagedSnapshot.document,
      stagedSnapshot.compatibilityDate,
      options.corrections,
    );
    const normalizedModel = await normalizeDocument(corrected.document, options.normalization);
    const outputDirectory = join(workspace, 'outputs');
    await mkdir(outputDirectory, { recursive: true });

    const snapshot = serializeJson(corrected.document);
    const sha256 = createHash('sha256').update(snapshot).digest('hex');
    const facadeCatalogPath = resolve(
      options.operationMetadata?.facadeCatalogPath ?? defaultFacadeCatalogPath,
    );
    const [facadeCatalogSource, facadeCatalog, operationMetadata] = await Promise.all([
      readFile(facadeCatalogPath, 'utf8'),
      loadFacadeCatalog(normalizedModel, facadeCatalogPath),
      resolveOperationMetadata(normalizedModel, options.operationMetadata),
    ]);
    const provenanceWithoutReport = Object.freeze({
      appliedCorrections: corrected.appliedCorrections,
      compatibilityDate: stagedSnapshot.compatibilityDate,
      facadeCatalog: {
        path: relative(projectRoot, facadeCatalogPath).replaceAll('\\', '/'),
        sha256: hash(facadeCatalogSource),
      },
      sha256,
      sourceSha256: stagedSnapshot.sha256,
      specificationUrl: options.openapi?.specificationUrl ?? defaultSpecificationUrl,
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
        sha256: hash(namingReviewReport),
      },
    });
    const accountingReport = createOperationAccountingReport(normalizedModel, operationMetadata);
    await writeOpenApiOutput(
      outputDirectory,
      snapshot,
      normalizedModel,
      provenance,
      accountingReport,
    );

    const context: EmitterContext = Object.freeze({
      compatibilityDate: stagedSnapshot.compatibilityDate,
      correctedDocument: corrected.document,
      normalizedModel,
      namingReviewReport,
      operationMetadata,
      outputDirectory,
      outputPath: (target: string) => resolveOutputPath(outputDirectory, target),
      provenance,
    });
    const claims = await emitConfiguredOutputs(context, options.emitters ?? []);

    await validateClaims(claims, outputDirectory);
    await materializeIncomingPaths(outputDirectory, projectRoot, transaction, materializePath);
    await replaceGeneratedPaths(transaction, replacePath);
    result = Object.freeze({
      compatibilityDate: stagedSnapshot.compatibilityDate,
      replacedTargets: generatedReplacementTargets,
      sha256,
    });
  } catch (error) {
    failure = error;
  }

  const cleanupFailures = await cleanupGeneration(transaction, stagedSnapshot, workspace);

  if (failure && cleanupFailures.length > 0) {
    throw new AggregateError([failure, ...cleanupFailures], 'Generation and cleanup failed');
  }
  if (failure) throw failure;
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, 'Generation cleanup failed');
  }
  if (result === undefined) throw new Error('Generation did not produce a result');
  return result;
}

function resolveOutputPath(outputDirectory: string, target: string): string {
  if (!generatedTargetKinds.has(target)) {
    throw new Error(`Emitter requested unexpected generated target: ${target}`);
  }
  return join(outputDirectory, target);
}

async function emitConfiguredOutputs(
  context: EmitterContext,
  emitters: readonly GeneratedOutputEmitter[],
): Promise<ClaimedOutput[]> {
  const claims: ClaimedOutput[] = [
    { emitter: 'openapi-snapshot', kind: 'directory', target: 'openapi/generated' },
  ];
  const emitterNames = new Set<string>();
  for (const emitter of emitters) {
    validateEmitter(emitter, emitterNames);
    emitterNames.add(emitter.name);
    const emittedClaims = await emitter.emit(context);
    if (!Array.isArray(emittedClaims)) {
      throw new TypeError(`Emitter ${emitter.name} did not return output claims`);
    }
    for (const claim of emittedClaims) claims.push({ ...claim, emitter: emitter.name });
  }
  return claims;
}

function validateEmitter(emitter: GeneratedOutputEmitter, emitterNames: Set<string>): void {
  if (
    emitter === null ||
    typeof emitter !== 'object' ||
    typeof emitter.name !== 'string' ||
    emitter.name.length === 0 ||
    typeof emitter.emit !== 'function'
  ) {
    throw new Error('Invalid generated output emitter');
  }
  if (emitterNames.has(emitter.name)) {
    throw new Error(`Duplicate emitter name: ${emitter.name}`);
  }
}

async function cleanupGeneration(
  transaction: readonly TransactionEntry[],
  stagedSnapshot: StagedOpenApiSnapshot | undefined,
  workspace: string | undefined,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  try {
    await cleanupTransactionPaths(transaction);
  } catch (error) {
    failures.push(error);
  }
  if (stagedSnapshot) {
    try {
      await stagedSnapshot.cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (workspace) {
    try {
      await rm(workspace, { force: true, recursive: true });
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

async function writeOpenApiOutput(
  outputDirectory: string,
  snapshot: string,
  normalizedModel: NormalizedOpenApiModel,
  provenance: GenerationProvenance,
  accountingReport: OperationAccountingReport,
): Promise<void> {
  const directory = join(outputDirectory, 'openapi/generated');
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'esi-openapi.json'), snapshot),
    writeFile(join(directory, 'normalized-model.json'), serializeJson(normalizedModel)),
    writeFile(
      join(directory, 'operation-accounting.json'),
      renderGeneratedJson(accountingReport, provenance),
    ),
    writeFile(join(directory, 'provenance.json'), serializeJson(provenance)),
  ]);
}

async function validateClaims(
  claims: readonly ClaimedOutput[],
  outputDirectory: string,
): Promise<void> {
  const claimedTargets = new Set<string>();
  for (const claim of claims) {
    const expectedKind = validateClaim(claim, claimedTargets);
    const status = await readClaimStatus(outputDirectory, claim);
    validateClaimStatus(claim, expectedKind, status);
    claimedTargets.add(claim.target);
  }

  const missing = generatedReplacementTargets.filter((target) => !claimedTargets.has(target));
  if (missing.length > 0) {
    throw new Error(`Missing generated output claims: ${missing.join(', ')}`);
  }
}

function validateClaim(claim: ClaimedOutput, claimedTargets: ReadonlySet<string>): string {
  if (
    claim === null ||
    typeof claim !== 'object' ||
    typeof claim.target !== 'string' ||
    (claim.kind !== 'file' && claim.kind !== 'directory')
  ) {
    throw new Error(`Emitter ${claim?.emitter ?? 'unknown'} returned an invalid output claim`);
  }
  const expectedKind = generatedTargetKinds.get(claim.target);
  if (expectedKind === undefined) {
    throw new Error(
      `Emitter ${claim.emitter} claimed unexpected generated target: ${claim.target}`,
    );
  }
  if (claimedTargets.has(claim.target)) {
    throw new Error(`Duplicate generated output claim: ${claim.target}`);
  }
  if (claim.kind !== expectedKind) {
    throw new Error(
      `Generated output ${claim.target} must be a ${expectedKind}, not a ${claim.kind}`,
    );
  }
  return expectedKind;
}

async function readClaimStatus(
  outputDirectory: string,
  claim: ClaimedOutput,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  try {
    return await lstat(join(outputDirectory, claim.target));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(`Claimed generated output is missing: ${claim.target}`, { cause: error });
    }
    throw error;
  }
}

function validateClaimStatus(
  claim: ClaimedOutput,
  expectedKind: string,
  status: Awaited<ReturnType<typeof lstat>>,
): void {
  if (status.isSymbolicLink()) {
    throw new Error(`Generated output must not be a symbolic link: ${claim.target}`);
  }
  if (
    (expectedKind === 'file' && !status.isFile()) ||
    (expectedKind === 'directory' && !status.isDirectory())
  ) {
    throw new Error(`Generated output has the wrong filesystem type: ${claim.target}`);
  }
}

async function materializeIncomingPaths(
  outputDirectory: string,
  projectRoot: string,
  transaction: TransactionEntry[],
  materializePath: (source: string, destination: string) => Promise<void>,
): Promise<void> {
  const transactionId = randomUUID();
  for (const target of generatedReplacementTargets) {
    const livePath = resolve(projectRoot, target);
    const parent = dirname(livePath);
    const name = basename(livePath);
    const entry: TransactionEntry = {
      backupPath: join(parent, `.${name}.esi-client-backup-${transactionId}`),
      backedUp: false,
      incomingPath: join(parent, `.${name}.esi-client-incoming-${transactionId}`),
      installed: false,
      livePath,
    };
    transaction.push(entry);
    await mkdir(parent, { recursive: true });
    await materializePath(join(outputDirectory, target), entry.incomingPath);
  }
}

async function replaceGeneratedPaths(
  transaction: TransactionEntry[],
  replacePath: (source: string, destination: string, phase: ReplacementPhase) => Promise<void>,
): Promise<void> {
  try {
    for (const entry of transaction) {
      if (await pathExists(entry.livePath)) {
        await replacePath(entry.livePath, entry.backupPath, 'backup');
        entry.backedUp = true;
      }
      await replacePath(entry.incomingPath, entry.livePath, 'install');
      entry.installed = true;
    }
  } catch (error) {
    const rollbackFailures = await rollbackGeneratedPaths(transaction, replacePath);
    if (rollbackFailures.length > 0) {
      throw new AggregateError([error, ...rollbackFailures], 'Replacement and rollback failed', {
        cause: error,
      });
    }
    throw error;
  }

  for (const entry of transaction) {
    if (!entry.backedUp) continue;
    await rm(entry.backupPath, { force: true, recursive: true });
    entry.backedUp = false;
  }
}

async function rollbackGeneratedPaths(
  transaction: TransactionEntry[],
  replacePath: (source: string, destination: string, phase: ReplacementPhase) => Promise<void>,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const entry of transaction.toReversed()) {
    try {
      if (entry.installed) {
        await rm(entry.livePath, { force: true, recursive: true });
        entry.installed = false;
      }
      if (entry.backedUp) {
        await replacePath(entry.backupPath, entry.livePath, 'restore');
        entry.backedUp = false;
      }
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

async function cleanupTransactionPaths(transaction: readonly TransactionEntry[]): Promise<void> {
  for (const entry of transaction) {
    await rm(entry.incomingPath, { force: true, recursive: true });
    if (!entry.backedUp) await rm(entry.backupPath, { force: true, recursive: true });
  }
}

async function copyPath(source: string, destination: string): Promise<void> {
  await cp(source, destination, { errorOnExist: true, force: false, recursive: true });
}

async function renamePath(source: string, destination: string): Promise<void> {
  await rename(source, destination);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      })
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}
