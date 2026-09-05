import { mkdir, readFile, rename, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { replaceGeneratedPathsAtomically } from '../scripts/generate/atomic-replacement.ts';
import { emitGeneratedArtifacts } from '../scripts/generate/emit-artifacts.ts';
import { prepareGenerationContext } from '../scripts/generate/generation-context.ts';
import type {
  EmitterContext,
  GeneratedOutputClaim,
  GeneratedOutputEmitter,
} from '../scripts/generate/generation-contracts.ts';
import { generatedTargets } from '../scripts/generate/paths.ts';
import { makeTemporaryDirectory } from './helpers/temporary-directory.js';

const emittedTargets = generatedTargets.filter(({ category }) => category !== 'openapi');

function makeContext(outputDirectory: string): EmitterContext {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- emission only reads the output directory and path resolver
  return {
    outputDirectory,
    outputPath: (target: string) => join(outputDirectory, target),
  } as unknown as EmitterContext;
}

function emitter(
  emit: (context: EmitterContext) => Promise<readonly GeneratedOutputClaim[]>,
  name = 'test-emitter',
): GeneratedOutputEmitter {
  return { name, emit };
}

async function writeTargets(
  context: EmitterContext,
  skip?: string,
): Promise<readonly GeneratedOutputClaim[]> {
  for (const target of emittedTargets) {
    if (target.path === skip) continue;
    const path = context.outputPath(target.path);
    if (target.kind === 'file') {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `content of ${target.path}\n`);
    } else {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, 'generated.txt'), `content of ${target.path}\n`);
    }
  }
  return emittedTargets
    .filter(({ path }) => path !== skip)
    .map(({ path, kind }) => ({ target: path, kind }));
}

describe('generated artifact emission', () => {
  it('accepts a complete claim set that matches the manifest', async () => {
    const context = makeContext(await makeTemporaryDirectory('esi-emit-ok-'));
    const produced = await emitGeneratedArtifacts(
      context,
      [emitter((current) => writeTargets(current))],
      emittedTargets,
    );
    expect(produced).toEqual(emittedTargets.map(({ path }) => path));
  });

  it('rejects a claim set missing a declared target', async () => {
    const context = makeContext(await makeTemporaryDirectory('esi-emit-missing-'));
    await expect(
      emitGeneratedArtifacts(
        context,
        [emitter((current) => writeTargets(current, 'tests/generated'))],
        emittedTargets,
      ),
    ).rejects.toThrow('Missing generated output claims: tests/generated');
  });

  it('rejects a claim for a target outside the manifest', async () => {
    const context = makeContext(await makeTemporaryDirectory('esi-emit-unexpected-'));
    await expect(
      emitGeneratedArtifacts(
        context,
        [
          emitter(async (current) => [
            ...(await writeTargets(current)),
            { target: 'src/runtime.ts', kind: 'file' as const },
          ]),
        ],
        emittedTargets,
      ),
    ).rejects.toThrow('claimed unexpected generated target: src/runtime.ts');
  });

  it('rejects a duplicate claim', async () => {
    const context = makeContext(await makeTemporaryDirectory('esi-emit-duplicate-'));
    await expect(
      emitGeneratedArtifacts(
        context,
        [
          emitter(async (current) => [
            ...(await writeTargets(current)),
            { target: 'llms.txt', kind: 'file' as const },
          ]),
        ],
        emittedTargets,
      ),
    ).rejects.toThrow('Duplicate generated output claim: llms.txt');
  });

  it('rejects a claim whose staged output was never written', async () => {
    const context = makeContext(await makeTemporaryDirectory('esi-emit-absent-'));
    await expect(
      emitGeneratedArtifacts(
        context,
        [
          emitter(async (current) => {
            await writeTargets(current, 'examples/generated');
            return emittedTargets.map(({ path, kind }) => ({ target: path, kind }));
          }),
        ],
        emittedTargets,
      ),
    ).rejects.toThrow('Claimed generated output is missing: examples/generated');
  });

  it('rejects a claim whose filesystem kind disagrees with the manifest', async () => {
    const context = makeContext(await makeTemporaryDirectory('esi-emit-kind-'));
    await expect(
      emitGeneratedArtifacts(
        context,
        [
          emitter(async (current) => {
            await writeTargets(current);
            return [{ target: 'llms.txt', kind: 'directory' as const }];
          }),
        ],
        emittedTargets,
      ),
    ).rejects.toThrow('Generated output llms.txt must be a file, not a directory');
  });

  it('rejects duplicate emitter names', async () => {
    const context = makeContext(await makeTemporaryDirectory('esi-emit-dupe-name-'));
    await expect(
      emitGeneratedArtifacts(
        context,
        [emitter((current) => writeTargets(current), 'same'), emitter(async () => [], 'same')],
        emittedTargets,
      ),
    ).rejects.toThrow('Duplicate emitter name: same');
  });
});

async function makeTrees(): Promise<{ staged: string; project: string }> {
  const root = await makeTemporaryDirectory('esi-replace-');
  const staged = join(root, 'staged');
  const project = join(root, 'project');
  for (const target of generatedTargets) {
    const path = join(staged, target.path);
    if (target.kind === 'file') {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `new ${target.path}\n`);
    } else {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, 'generated.txt'), `new ${target.path}\n`);
    }
  }
  for (const target of generatedTargets) {
    const path = join(project, target.path);
    if (target.kind === 'file') {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `old ${target.path}\n`);
    } else {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, 'generated.txt'), `old ${target.path}\n`);
    }
  }
  await mkdir(join(project, 'src'), { recursive: true });
  await writeFile(join(project, 'src/maintained.ts'), 'maintained\n');
  return { staged, project };
}

async function expectNoDebris(project: string): Promise<void> {
  for (const directory of ['.', 'src', 'docs', 'examples', 'tests', 'openapi']) {
    const entries = await readdir(join(project, directory));
    expect(entries.filter((entry) => entry.includes('esi-client-'))).toEqual([]);
  }
}

describe('atomic generated-path replacement', () => {
  const targets = generatedTargets.map(({ path }) => path);

  it('installs every staged target over the live tree', async () => {
    const { staged, project } = await makeTrees();
    await replaceGeneratedPathsAtomically(staged, project, targets);

    await expect(readFile(join(project, 'llms.txt'), 'utf8')).resolves.toBe('new llms.txt\n');
    await expect(readFile(join(project, 'src/generated/generated.txt'), 'utf8')).resolves.toBe(
      'new src/generated\n',
    );
    await expect(readFile(join(project, 'src/maintained.ts'), 'utf8')).resolves.toBe(
      'maintained\n',
    );
    await expectNoDebris(project);
  });

  it('restores the prior tree when an install fails partway through', async () => {
    const { staged, project } = await makeTrees();
    let failed = false;

    await expect(
      replaceGeneratedPathsAtomically(staged, project, targets, {
        replacePath: async (source, destination, phase) => {
          if (!failed && phase === 'install' && destination.endsWith(join('docs', 'generated'))) {
            failed = true;
            throw new Error('replacement failed');
          }
          await rename(source, destination);
        },
      }),
    ).rejects.toThrow('replacement failed');

    for (const target of generatedTargets) {
      const path = join(project, target.path);
      const file = target.kind === 'file' ? path : join(path, 'generated.txt');
      await expect(readFile(file, 'utf8')).resolves.toBe(`old ${target.path}\n`);
    }
    await expect(readFile(join(project, 'src/maintained.ts'), 'utf8')).resolves.toBe(
      'maintained\n',
    );
    await expectNoDebris(project);
  });

  it('reports rollback failures alongside the original failure', async () => {
    const { staged, project } = await makeTrees();

    await expect(
      replaceGeneratedPathsAtomically(staged, project, targets, {
        replacePath: async (source, destination, phase) => {
          if (phase === 'install' && destination.endsWith(join('docs', 'generated'))) {
            throw new Error('replacement failed');
          }
          if (phase === 'restore') throw new Error('restore failed');
          await rename(source, destination);
        },
      }),
    ).rejects.toThrow(/Replacement and rollback failed|replacement failed/u);
  });

  it('refuses a target that is not declared generated output', async () => {
    const { staged, project } = await makeTrees();

    await expect(
      replaceGeneratedPathsAtomically(staged, project, ['src/runtime.ts']),
    ).rejects.toThrow('Refusing to replace non-generated path: src/runtime.ts');
    await expect(readFile(join(project, 'src/maintained.ts'), 'utf8')).resolves.toBe(
      'maintained\n',
    );
  });

  it('refuses a duplicated target', async () => {
    const { staged, project } = await makeTrees();

    await expect(
      replaceGeneratedPathsAtomically(staged, project, ['llms.txt', 'llms.txt']),
    ).rejects.toThrow('Duplicate generated replacement target: llms.txt');
  });

  it('keeps installed output when discarding a backup fails after commit', async () => {
    const { staged, project } = await makeTrees();

    const failure = await replaceGeneratedPathsAtomically(staged, project, targets, {
      removePath: async (path) => {
        if (path.includes('esi-client-backup-')) throw new Error('backup removal failed');
        await rm(path, { force: true, recursive: true });
      },
    }).catch((error: unknown) => error);

    // The transaction committed, so every target must hold the new output.
    for (const target of generatedTargets) {
      const path = join(project, target.path);
      const file = target.kind === 'file' ? path : join(path, 'generated.txt');
      await expect(readFile(file, 'utf8')).resolves.toBe(`new ${target.path}\n`);
    }
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.message).toBe('Generated output was installed, but replacement cleanup failed');
  });

  it('reports a pre-commit cleanup failure without claiming the output was installed', async () => {
    const { staged, project } = await makeTrees();

    const failure = await replaceGeneratedPathsAtomically(staged, project, targets, {
      replacePath: async (source, destination, phase) => {
        if (phase === 'install' && destination.endsWith(join('docs', 'generated'))) {
          throw new Error('replacement failed');
        }
        await rename(source, destination);
      },
    }).catch((error: unknown) => error);

    if (!(failure instanceof Error)) throw failure;
    expect(failure.message).not.toContain('was installed');
    for (const target of generatedTargets) {
      const path = join(project, target.path);
      const file = target.kind === 'file' ? path : join(path, 'generated.txt');
      await expect(readFile(file, 'utf8')).resolves.toBe(`old ${target.path}\n`);
    }
  });
});

describe('project root isolation', () => {
  it('reads configuration from the given project root, not the package root', async () => {
    const projectRoot = await makeTemporaryDirectory('esi-project-root-');
    const workspace = await makeTemporaryDirectory('esi-project-root-out-');
    await mkdir(join(projectRoot, 'openapi/config'), { recursive: true });
    // A catalog that is deliberately empty: if configuration were read from the package root
    // this would be ignored and preparation would succeed.
    await writeFile(
      join(projectRoot, 'openapi/config/naming-overrides.json'),
      `${JSON.stringify({ schemaVersion: 2, operations: [] })}\n`,
    );
    await writeFile(
      join(projectRoot, 'openapi/config/safety-overrides.json'),
      `${JSON.stringify({ schemaVersion: 1, overrides: [] })}\n`,
    );
    await writeFile(
      join(projectRoot, 'openapi/config/exclusions.json'),
      `${JSON.stringify({ schemaVersion: 1, exclusions: [] })}\n`,
    );

    const document = {
      openapi: '3.1.0',
      info: { title: 'Project root fixture', version: '1.0.0' },
      paths: {
        '/items': {
          get: { operationId: 'get_items', responses: { '204': { description: 'No content' } } },
        },
      },
    };

    await expect(
      prepareGenerationContext(
        {
          appliedCorrections: [],
          compatibilityDate: '2026-08-18',
          document,
          sha256: 'a'.repeat(64),
          sourceSha256: 'b'.repeat(64),
          specificationUrl: 'https://example.test/openapi.json',
        },
        workspace,
        projectRoot,
      ),
    ).rejects.toThrow('Missing facade catalog entries: get_items');
  });
});
