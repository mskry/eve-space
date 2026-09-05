import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Operation } from '@bybrave/fast-json-patch2';
import { applyPatch } from '@bybrave/fast-json-patch2';

export interface SpecificationCorrectionOptions {
  manifestPath?: string;
  expiredCorrectionPolicy?: 'fail' | 'skip';
}

export interface AppliedSpecificationCorrections<T> {
  readonly appliedCorrections: readonly string[];
  readonly document: T;
}

interface CorrectionManifestEntry {
  readonly id: string;
  readonly patch: string;
  readonly reason: string;
  readonly from: string;
  readonly through: string;
}

interface CorrectionManifest {
  readonly schemaVersion: number;
  readonly corrections: readonly CorrectionManifestEntry[];
}

export const defaultCorrectionManifestPath: string = fileURLToPath(
  new URL('../../openapi/corrections/manifest.json', import.meta.url),
);

export async function applySpecificationCorrections<T>(
  document: T,
  compatibilityDate: string,
  options: SpecificationCorrectionOptions = {},
): Promise<AppliedSpecificationCorrections<T>> {
  const manifestPath = options.manifestPath ?? defaultCorrectionManifestPath;
  const expiredCorrectionPolicy = options.expiredCorrectionPolicy ?? 'fail';
  if (!['fail', 'skip'].includes(expiredCorrectionPolicy)) {
    throw new Error(`Invalid expired correction policy: ${expiredCorrectionPolicy}`);
  }
  const manifest: CorrectionManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest);

  let correctedDocument = structuredClone(document);
  const appliedCorrections: string[] = [];
  for (const correction of manifest.corrections) {
    const operations = await readCorrectionOperations(manifestPath, correction);
    const applicability = compareDateRange(compatibilityDate, correction);

    if (applicability === 'before') continue;
    if (applicability === 'expired') {
      if (expiredCorrectionPolicy === 'fail' && patchStillApplies(correctedDocument, operations)) {
        throw new Error(`Expired correction still applies: ${correction.id}`);
      }
      continue;
    }

    try {
      correctedDocument = applyPatch(correctedDocument, operations, true, false, true).newDocument;
    } catch (error) {
      throw new Error(`Failed to apply correction ${correction.id}`, { cause: error });
    }
    appliedCorrections.push(correction.id);
  }

  return Object.freeze({
    appliedCorrections: Object.freeze(appliedCorrections),
    document: correctedDocument,
  });
}

async function readCorrectionOperations(
  manifestPath: string,
  correction: CorrectionManifestEntry,
): Promise<Operation[]> {
  const manifestDirectory = dirname(manifestPath);
  const patchPath = resolve(manifestDirectory, correction.patch);
  const pathFromManifest = relative(manifestDirectory, patchPath);
  if (pathFromManifest.startsWith('..') || pathFromManifest === '') {
    throw new Error(`Correction patch must be inside the manifest directory: ${correction.patch}`);
  }

  const operations: Operation[] = JSON.parse(await readFile(patchPath, 'utf8'));
  if (!Array.isArray(operations) || operations.length < 2 || operations[0]?.op !== 'test') {
    throw new Error(`Correction ${correction.id} must begin with a test precondition`);
  }
  if (!operations.some(({ op }) => op !== 'test')) {
    throw new Error(`Correction ${correction.id} has no mutation operation`);
  }
  return operations;
}

function validateManifest(manifest: CorrectionManifest): void {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.corrections)) {
    throw new Error('Invalid correction manifest');
  }

  const identifiers = new Set<string>();
  for (const correction of manifest.corrections) {
    if (
      typeof correction?.id !== 'string' ||
      correction.id.length === 0 ||
      typeof correction.patch !== 'string' ||
      typeof correction.reason !== 'string' ||
      correction.reason.length === 0 ||
      !isCompatibilityDate(correction.from) ||
      !isCompatibilityDate(correction.through) ||
      correction.from > correction.through
    ) {
      throw new Error(`Invalid correction manifest entry: ${correction?.id ?? 'unknown'}`);
    }
    if (identifiers.has(correction.id)) {
      throw new Error(`Duplicate correction identifier: ${correction.id}`);
    }
    identifiers.add(correction.id);
  }
}

function compareDateRange(
  compatibilityDate: string,
  correction: CorrectionManifestEntry,
): 'before' | 'expired' | 'active' {
  if (!isCompatibilityDate(compatibilityDate)) {
    throw new Error(`Invalid ESI compatibility date: ${compatibilityDate}`);
  }
  if (compatibilityDate < correction.from) return 'before';
  if (compatibilityDate > correction.through) return 'expired';
  return 'active';
}

function patchStillApplies(document: unknown, operations: readonly Operation[]): boolean {
  try {
    applyPatch(document, operations, true, false, true);
    return true;
  } catch {
    return false;
  }
}

function isCompatibilityDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
