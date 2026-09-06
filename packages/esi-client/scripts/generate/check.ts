import { mkdtemp, lstat, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readCommittedSnapshot } from './committed-snapshot.ts';
import { emitGeneratedArtifacts, writeOpenApiArtifacts } from './emit-artifacts.ts';
import { emittedTargets, offlineEmitters } from './generation-emitters.ts';
import type { GenerationProvenance } from './generation-contracts.ts';
import { prepareGenerationContext } from './generation-context.ts';
import { compareText } from './internal/text.ts';
import { generatedTargets, repositoryRoot } from './paths.ts';

export interface GenerationCheckResult {
  readonly compatibilityDate: string;
  readonly fileCount: number;
  readonly sha256: string;
}

interface PathSnapshotEntry {
  readonly kind: 'file' | 'directory';
  readonly content: string;
}

export const generationCheckTargets: readonly string[] = Object.freeze(
  generatedTargets.map(({ path }) => path),
);

/**
 * Regenerates every artifact into a temporary directory and compares it against the committed
 * tree. This command never writes inside the project: it has no access to the replacement
 * transaction at all, so staleness cannot be "fixed" by running it.
 */
export async function checkGeneratedOutputs(
  root: string = repositoryRoot,
): Promise<GenerationCheckResult> {
  const projectRoot = resolve(root);
  const workspace = await mkdtemp(join(tmpdir(), 'esi-client-generate-check-'));

  try {
    const committed = await readCommittedSnapshot(projectRoot);

    const { context } = await prepareGenerationContext(committed.input, workspace, projectRoot);
    assertProvenanceMatches(committed.provenance, context.provenance);

    await emitGeneratedArtifacts(context, offlineEmitters, emittedTargets);
    await writeOpenApiArtifacts(
      workspace,
      committed.canonicalSnapshot,
      context,
      context.provenance,
    );

    const result = await compareGeneratedOutputs(workspace, projectRoot, generationCheckTargets);
    return {
      ...result,
      compatibilityDate: committed.input.compatibilityDate,
      sha256: context.provenance.sha256,
    };
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

function assertProvenanceMatches(
  committed: GenerationProvenance,
  prepared: GenerationProvenance,
): void {
  if (
    committed.facadeCatalog?.path !== prepared.facadeCatalog.path ||
    committed.facadeCatalog?.sha256 !== prepared.facadeCatalog.sha256 ||
    committed.facadeReviewReport?.path !== prepared.facadeReviewReport.path ||
    committed.facadeReviewReport?.sha256 !== prepared.facadeReviewReport.sha256
  ) {
    throw new Error(
      'Committed facade catalog, naming review report, and provenance are inconsistent',
    );
  }
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

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const result = await checkGeneratedOutputs();
  process.stdout.write(
    `Generated output is current: ${result.fileCount} files for ESI ${result.compatibilityDate} (${result.sha256}).\n`,
  );
}
