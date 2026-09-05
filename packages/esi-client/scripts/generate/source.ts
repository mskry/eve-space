import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { replaceGeneratedPathsAtomically } from './atomic-replacement.ts';
import { readCommittedSnapshot } from './committed-snapshot.ts';
import { applySpecificationCorrections } from './corrections.ts';
import { emitGeneratedArtifacts, writeOpenApiArtifacts } from './emit-artifacts.ts';
import { emittedTargets, offlineEmitters } from './generation-emitters.ts';
import { prepareGenerationContext, type GenerationInput } from './generation-context.ts';
import { hashText, serializeJson } from './internal/json.ts';
import { defaultSpecificationUrl, stageOpenApiSnapshot } from './openapi.ts';
import type { StagedOpenApiSnapshot } from './openapi.ts';
import { generatedTargets, repositoryRoot, resolveConfigPath } from './paths.ts';

export interface GenerateSourceOptions {
  /** Fetch a fresh specification instead of reusing the committed corrected snapshot. */
  readonly refreshSnapshot?: boolean;
  readonly projectRoot?: string;
}

export interface GenerationResult {
  readonly compatibilityDate: string;
  readonly replacedTargets: readonly string[];
  readonly sha256: string;
}

interface CorrectedInput {
  readonly input: GenerationInput;
  readonly stagedSnapshot: StagedOpenApiSnapshot | undefined;
}

const replacementTargets = generatedTargets.map(({ path }) => path);

export async function generateSource(
  options: GenerateSourceOptions = {},
): Promise<GenerationResult> {
  const projectRoot = resolve(options.projectRoot ?? repositoryRoot);
  const workspace = await mkdtemp(join(projectRoot, '.esi-source-generation-'));
  let stagedSnapshot: StagedOpenApiSnapshot | undefined;
  let result: GenerationResult | undefined;
  let failure: unknown;

  try {
    const corrected = options.refreshSnapshot
      ? await retrieveCorrectedInput(workspace, projectRoot)
      : { input: (await readCommittedSnapshot(projectRoot)).input, stagedSnapshot: undefined };
    stagedSnapshot = corrected.stagedSnapshot;

    const { context } = await prepareGenerationContext(corrected.input, workspace, projectRoot);
    await emitGeneratedArtifacts(context, offlineEmitters, emittedTargets);
    await writeOpenApiArtifacts(
      workspace,
      serializeJson(corrected.input.document),
      context,
      context.provenance,
    );

    await replaceGeneratedPathsAtomically(workspace, projectRoot, replacementTargets);
    result = Object.freeze({
      compatibilityDate: context.provenance.compatibilityDate,
      replacedTargets: replacementTargets,
      sha256: context.provenance.sha256,
    });
  } catch (error) {
    failure = error;
  }

  const cleanupErrors = (
    await Promise.allSettled([
      stagedSnapshot?.cleanup(),
      rm(workspace, { force: true, recursive: true }),
    ])
  )
    .filter((outcome) => outcome.status === 'rejected')
    .map((outcome) => outcome.reason);

  if (failure !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [failure, ...cleanupErrors],
        'Source generation and cleanup failed',
        {
          cause: failure,
        },
      );
    }
    throw failure;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Source generation cleanup failed');
  }
  if (result === undefined) throw new Error('Source generation did not produce a result');
  return result;
}

async function retrieveCorrectedInput(
  workspaceDirectory: string,
  projectRoot: string,
): Promise<CorrectedInput> {
  const staged = await stageOpenApiSnapshot({
    pinnedDatePath: resolveConfigPath('compatibilityDate', projectRoot),
    temporaryRoot: workspaceDirectory,
  });
  const corrected = await applySpecificationCorrections(staged.document, staged.compatibilityDate, {
    manifestPath: resolveConfigPath('correctionManifest', projectRoot),
  });
  return {
    input: {
      appliedCorrections: corrected.appliedCorrections,
      compatibilityDate: staged.compatibilityDate,
      document: corrected.document,
      sha256: hashText(serializeJson(corrected.document)),
      sourceSha256: staged.sha256,
      specificationUrl: defaultSpecificationUrl,
    },
    stagedSnapshot: staged,
  };
}

const refreshSnapshotFlag = '--refresh-snapshot';
const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const commandArguments = process.argv.slice(2);
  if (commandArguments.some((argument) => argument !== refreshSnapshotFlag)) {
    throw new Error(`Unknown source generation option: ${commandArguments.join(' ')}`);
  }
  const generated = await generateSource({
    refreshSnapshot: commandArguments.includes(refreshSnapshotFlag),
  });
  process.stdout.write(
    `Generated source, documentation, examples, and OpenAPI artifacts for ESI compatibility date ${generated.compatibilityDate} (${generated.sha256}).\n`,
  );
}
