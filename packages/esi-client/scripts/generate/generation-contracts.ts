import type { NormalizedOpenApiModel } from './normalize.ts';
import type { ResolvedOperationMetadata } from './operation-metadata.ts';
import type { GeneratedOutputKind } from './paths.ts';

export type { GeneratedOutputKind };
export type ReplacementPhase = 'backup' | 'install' | 'restore';

export interface GeneratedOutputClaim {
  readonly target: string;
  readonly kind: GeneratedOutputKind;
}

export interface GenerationProvenanceArtifact {
  readonly path: string;
  readonly sha256: string;
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
