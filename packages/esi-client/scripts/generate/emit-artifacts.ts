import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createOperationAccountingReport, renderGeneratedJson } from './artifacts.ts';
import type {
  EmitterContext,
  GeneratedOutputClaim,
  GeneratedOutputEmitter,
  GenerationProvenance,
} from './generation-contracts.ts';
import { serializeJson } from './internal/json.ts';
import { generatedTargets, type GeneratedTarget } from './paths.ts';

interface ClaimedOutput extends GeneratedOutputClaim {
  readonly emitter: string;
}

/**
 * Runs the configured emitters and enforces the output contract: only declared targets, correct
 * filesystem kinds, no duplicates, no symbolic links, and every expected target produced.
 * Both `generate` and `generate:check` go through this so neither can accept output the other
 * would reject.
 */
export async function emitGeneratedArtifacts(
  context: EmitterContext,
  emitters: readonly GeneratedOutputEmitter[],
  expectedTargets: readonly GeneratedTarget[],
): Promise<readonly string[]> {
  const claims: ClaimedOutput[] = [];
  const emitterNames = new Set<string>();
  for (const emitter of emitters) {
    validateEmitter(emitter, emitterNames);
    emitterNames.add(emitter.name);
    const emitted = await emitter.emit(context);
    if (!Array.isArray(emitted)) {
      throw new TypeError(`Emitter ${emitter.name} did not return output claims`);
    }
    for (const claim of emitted) claims.push({ ...claim, emitter: emitter.name });
  }

  const claimedTargets = new Set<string>();
  for (const claim of claims) {
    const expected = validateClaim(claim, claimedTargets);
    await validateClaimedPath(context.outputDirectory, claim, expected);
    claimedTargets.add(claim.target);
  }

  const missing = expectedTargets
    .filter(({ path }) => !claimedTargets.has(path))
    .map(({ path }) => path);
  if (missing.length > 0) {
    throw new Error(`Missing generated output claims: ${missing.join(', ')}`);
  }
  return Object.freeze(expectedTargets.map(({ path }) => path));
}

function validateEmitter(emitter: GeneratedOutputEmitter, emitterNames: ReadonlySet<string>): void {
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

function validateClaim(claim: ClaimedOutput, claimedTargets: ReadonlySet<string>): GeneratedTarget {
  if (
    claim === null ||
    typeof claim !== 'object' ||
    typeof claim.target !== 'string' ||
    (claim.kind !== 'file' && claim.kind !== 'directory')
  ) {
    throw new Error(`Emitter ${claim?.emitter ?? 'unknown'} returned an invalid output claim`);
  }
  const expected = generatedTargets.find(({ path }) => path === claim.target);
  if (expected === undefined) {
    throw new Error(
      `Emitter ${claim.emitter} claimed unexpected generated target: ${claim.target}`,
    );
  }
  if (claimedTargets.has(claim.target)) {
    throw new Error(`Duplicate generated output claim: ${claim.target}`);
  }
  if (claim.kind !== expected.kind) {
    throw new Error(
      `Generated output ${claim.target} must be a ${expected.kind}, not a ${claim.kind}`,
    );
  }
  return expected;
}

async function validateClaimedPath(
  outputDirectory: string,
  claim: ClaimedOutput,
  expected: GeneratedTarget,
): Promise<void> {
  let status;
  try {
    status = await lstat(join(outputDirectory, claim.target));
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Claimed generated output is missing: ${claim.target}`, { cause: error });
    }
    throw error;
  }
  if (status.isSymbolicLink()) {
    throw new Error(`Generated output must not be a symbolic link: ${claim.target}`);
  }
  if (
    (expected.kind === 'file' && !status.isFile()) ||
    (expected.kind === 'directory' && !status.isDirectory())
  ) {
    throw new Error(`Generated output has the wrong filesystem type: ${claim.target}`);
  }
}

/** Writes the `openapi/generated` artifacts that accompany every generation run. */
export async function writeOpenApiArtifacts(
  outputDirectory: string,
  correctedSnapshot: string,
  context: EmitterContext,
  provenance: GenerationProvenance,
): Promise<void> {
  const directory = join(outputDirectory, 'openapi/generated');
  const accounting = createOperationAccountingReport(
    context.normalizedModel,
    context.operationMetadata,
  );
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'esi-openapi.json'), correctedSnapshot),
    writeFile(join(directory, 'normalized-model.json'), serializeJson(context.normalizedModel)),
    writeFile(
      join(directory, 'operation-accounting.json'),
      renderGeneratedJson(accounting, provenance),
    ),
    writeFile(join(directory, 'provenance.json'), serializeJson(provenance)),
  ]);
}
