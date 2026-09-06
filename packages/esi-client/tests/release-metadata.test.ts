import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseReleaseTag, validateReleaseMetadata } from '../scripts/validate-release-metadata.ts';
import { makeTemporaryDirectory } from './helpers/temporary-directory.js';

const tag = '@evespace/esi-client@2.1.0';
const commit = '0123456789abcdef';

describe('ESI client release metadata', () => {
  it.each([
    '2.1.0',
    'esi-client-v2.1.0',
    '@other/esi-client@2.1.0',
    '@evespace/esi-client@2.1',
    '@evespace/esi-client@2.1.0-beta.1',
    '@evespace/esi-client@02.1.0',
  ])('rejects malformed or non-stable tag %s', (candidate) => {
    expect(() => parseReleaseTag(candidate)).toThrow('Release tag must match');
  });

  it('accepts an annotated stable unpublished tag on origin/main', async () => {
    const options = await releaseOptions();
    await expect(validateReleaseMetadata(options)).resolves.toEqual({
      commit,
      packageName: '@evespace/esi-client',
      tag,
      version: '2.1.0',
    });
  });

  it('rejects a lightweight tag', async () => {
    const options = await releaseOptions({ objectType: 'commit' });
    await expect(validateReleaseMetadata(options)).rejects.toThrow('must be annotated');
  });

  it('rejects a version that differs from package.json', async () => {
    const options = await releaseOptions({ version: '2.1.1' });
    await expect(validateReleaseMetadata(options)).rejects.toThrow(
      'does not match package version 2.1.1',
    );
  });

  it('rejects a commit outside origin/main', async () => {
    const options = await releaseOptions({ onMain: false });
    await expect(validateReleaseMetadata(options)).rejects.toThrow('not contained in origin/main');
  });

  it('rejects a missing changelog entry', async () => {
    const options = await releaseOptions({ changelog: '# Changelog\n' });
    await expect(validateReleaseMetadata(options)).rejects.toThrow(
      'must contain exactly one release heading',
    );
  });

  it('rejects the wrong package identity', async () => {
    const options = await releaseOptions({ name: '@evespace/other' });
    await expect(validateReleaseMetadata(options)).rejects.toThrow(
      'Release package must be @evespace/esi-client',
    );
  });

  it('rejects an already published version', async () => {
    const options = await releaseOptions({ published: true });
    await expect(validateReleaseMetadata(options)).rejects.toThrow('is already published');
  });
});

async function releaseOptions({
  changelog = '# Changelog\n\n## 2.1.0 - 2026-09-05\n',
  name = '@evespace/esi-client',
  objectType = 'tag',
  onMain = true,
  published = false,
  version = '2.1.0',
}: {
  readonly changelog?: string;
  readonly name?: string;
  readonly objectType?: string;
  readonly onMain?: boolean;
  readonly published?: boolean;
  readonly version?: string;
} = {}) {
  const repositoryRoot = await makeTemporaryDirectory('esi-client-release-metadata-');
  const packageRoot = join(repositoryRoot, 'packages/esi-client');
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, version })),
    writeFile(join(packageRoot, 'CHANGELOG.md'), changelog),
  ]);

  return {
    fetchRegistry: async () =>
      new Response(JSON.stringify({ versions: published ? { [version]: {} } : {} })),
    repositoryRoot,
    runGit: async (arguments_: readonly string[]) => {
      const command = arguments_.join(' ');
      if (command.startsWith('cat-file -t ')) return objectType;
      if (command.endsWith('^{}')) return commit;
      if (command === 'rev-parse HEAD') return commit;
      if (command.startsWith('merge-base --is-ancestor ')) {
        if (!onMain) throw new Error('not an ancestor');
        return '';
      }
      throw new Error(`Unexpected git command: ${command}`);
    },
    tag,
  };
}
