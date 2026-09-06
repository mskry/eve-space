import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { EmitterContext, GenerationProvenance } from './generation-contracts.ts';
import { hashText } from './internal/json.ts';
import { namingReviewReportPath, renderNamingReviewReport } from './naming-review.ts';
import { normalizeOpenApiDocument } from './normalize.ts';
import { parseFacadeCatalog, resolveOperationMetadata } from './operation-metadata.ts';
import {
  findGeneratedTarget,
  normalizeGeneratedPath,
  repositoryRoot,
  resolveConfigPath,
} from './paths.ts';

/**
 * A corrected specification snapshot plus the provenance facts that describe where it came from.
 * Preparation is deliberately ignorant of whether the caller fetched it or read a committed
 * snapshot, so `generate` and `generate:check` cannot drift in how they interpret it.
 */
export interface GenerationInput {
  readonly document: Record<string, unknown>;
  readonly appliedCorrections: readonly string[];
  readonly compatibilityDate: string;
  readonly sha256: string;
  readonly sourceSha256: string;
  readonly specificationUrl: string;
}

export interface PreparedGeneration {
  readonly context: EmitterContext;
  /** Retained so callers can verify a committed provenance record against this preparation. */
  readonly facadeCatalogSource: string;
}

export async function prepareGenerationContext(
  input: GenerationInput,
  outputDirectory: string,
  projectRoot: string = repositoryRoot,
): Promise<PreparedGeneration> {
  const facadeCatalogPath = resolveConfigPath('facadeCatalog', projectRoot);
  const normalizedModel = await normalizeOpenApiDocument(input.document, {
    exclusionsPath: resolveConfigPath('exclusions', projectRoot),
  });
  // One read backs the emitted metadata, the naming review report, and the provenance hash that
  // attests to them; re-reading would let a concurrent edit split them across catalog versions.
  const facadeCatalogSource = await readFile(facadeCatalogPath, 'utf8');
  const facadeCatalog = parseFacadeCatalog(normalizedModel, facadeCatalogSource, facadeCatalogPath);
  const operationMetadata = await resolveOperationMetadata(normalizedModel, {
    facadeCatalog,
    safetyOverridesPath: resolveConfigPath('safetyOverrides', projectRoot),
  });

  const provenanceWithoutReport = Object.freeze({
    appliedCorrections: input.appliedCorrections,
    compatibilityDate: input.compatibilityDate,
    facadeCatalog: {
      path: normalizeGeneratedPath(relative(projectRoot, facadeCatalogPath)),
      sha256: hashText(facadeCatalogSource),
    },
    sha256: input.sha256,
    sourceSha256: input.sourceSha256,
    specificationUrl: input.specificationUrl,
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
    compatibilityDate: input.compatibilityDate,
    correctedDocument: input.document,
    normalizedModel,
    namingReviewReport,
    operationMetadata,
    outputDirectory,
    outputPath: (target: string) => resolveOutputPath(outputDirectory, target),
    provenance,
  });
  return { context, facadeCatalogSource };
}

function resolveOutputPath(outputDirectory: string, target: string): string {
  if (findGeneratedTarget(target) === undefined) {
    throw new Error(`Emitter requested unexpected generated target: ${target}`);
  }
  return join(outputDirectory, target);
}
