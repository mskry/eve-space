import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GenerationProvenance } from './generation-contracts.ts';
import type { GenerationInput } from './generation-context.ts';
import { hashText, serializeJson } from './internal/json.ts';
import { resolveConfigPath } from './paths.ts';

export interface CommittedSnapshot {
  readonly input: GenerationInput;
  /** The canonical serialization the committed provenance hash is taken over. */
  readonly canonicalSnapshot: string;
  readonly provenance: GenerationProvenance;
}

/**
 * Reads and validates the committed corrected snapshot that both offline commands generate from.
 * Shared so `generate` and `generate:check` cannot disagree about what the pinned input is or
 * whether it is self-consistent.
 */
export async function readCommittedSnapshot(projectRoot: string): Promise<CommittedSnapshot> {
  const directory = join(projectRoot, 'openapi/generated');
  let snapshotSource: string;
  let provenance: GenerationProvenance;
  try {
    [snapshotSource, provenance] = await Promise.all([
      readFile(join(directory, 'esi-openapi.json'), 'utf8'),
      readFile(join(directory, 'provenance.json'), 'utf8').then(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- assertProvenance validates this shape below
        (text) => JSON.parse(text) as GenerationProvenance,
      ),
    ]);
  } catch (error) {
    throw new Error(
      `Missing corrected pinned snapshot; run pnpm generate:source:refresh once (${directory})`,
      { cause: error },
    );
  }

  const document: Record<string, unknown> = JSON.parse(snapshotSource);
  assertProvenance(provenance);
  const compatibilityDate = (
    await readFile(resolveConfigPath('compatibilityDate', projectRoot), 'utf8')
  ).trim();
  if (provenance.compatibilityDate !== compatibilityDate) {
    throw new Error(
      `Pinned snapshot date ${provenance.compatibilityDate} does not match ${compatibilityDate}`,
    );
  }
  const canonicalSnapshot = serializeJson(document);
  const sha256 = hashText(canonicalSnapshot);
  if (sha256 !== provenance.sha256) {
    throw new Error(
      `Pinned corrected snapshot hash mismatch: expected ${provenance.sha256}, got ${sha256}`,
    );
  }

  return {
    canonicalSnapshot,
    input: {
      appliedCorrections: provenance.appliedCorrections,
      compatibilityDate,
      document,
      sha256: provenance.sha256,
      sourceSha256: provenance.sourceSha256,
      specificationUrl: provenance.specificationUrl,
    },
    provenance,
  };
}

function assertProvenance(value: unknown): asserts value is GenerationProvenance {
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
