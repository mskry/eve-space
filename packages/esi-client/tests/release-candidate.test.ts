import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { retainPackage } from '../scripts/check-package.ts';
import { verifyReleaseCandidate } from '../scripts/lib/release-candidate.ts';
import { createTarball } from './helpers/tarball.js';
import { makeTemporaryDirectory } from './helpers/temporary-directory.js';

const execFileAsync = promisify(execFile);

describe('release candidate verification', () => {
  it('accepts matching bytes, digest, package identity, and version', async () => {
    const candidate = await createCandidate();
    await expect(verifyReleaseCandidate(candidate)).resolves.toMatchObject({
      packageName: '@evespace/esi-client',
      version: '2.1.0',
    });
  });

  it('accepts a scoped release tag through the verifier CLI', async () => {
    const candidate = await createCandidate();
    const verifierPath = fileURLToPath(
      new URL('../scripts/verify-release-candidate.ts', import.meta.url),
    );
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        verifierPath,
        '--tarball',
        candidate.tarballPath,
        '--digest',
        candidate.digestPath,
        '--tag',
        '@evespace/esi-client@2.1.0',
      ],
      { encoding: 'utf8' },
    );

    expect(JSON.parse(stdout)).toMatchObject({
      packageName: '@evespace/esi-client',
      version: '2.1.0',
    });
  });

  it('does not overwrite or remove an existing retained tarball', async () => {
    const sourceDirectory = await makeTemporaryDirectory('esi-client-release-source-');
    const destination = await makeTemporaryDirectory('esi-client-release-existing-');
    const source = join(sourceDirectory, 'source.tgz');
    const retainedTarball = join(destination, 'package.tgz');
    const retainedDigest = `${retainedTarball}.sha256`;
    await Promise.all([
      writeFile(source, 'new tarball'),
      writeFile(retainedTarball, 'existing tarball'),
      writeFile(retainedDigest, 'existing digest'),
    ]);

    await expect(retainPackage(source, destination)).rejects.toThrow('EEXIST');
    await expect(readFile(retainedTarball, 'utf8')).resolves.toBe('existing tarball');
    await expect(readFile(retainedDigest, 'utf8')).resolves.toBe('existing digest');
  });

  it('removes only its new tarball when the digest already exists', async () => {
    const sourceDirectory = await makeTemporaryDirectory('esi-client-release-source-');
    const destination = await makeTemporaryDirectory('esi-client-release-existing-');
    const source = join(sourceDirectory, 'source.tgz');
    const retainedTarball = join(destination, 'package.tgz');
    const retainedDigest = `${retainedTarball}.sha256`;
    await Promise.all([
      writeFile(source, 'new tarball'),
      writeFile(retainedDigest, 'existing digest'),
    ]);

    await expect(retainPackage(source, destination)).rejects.toThrow('EEXIST');
    await expect(stat(retainedTarball)).rejects.toThrow('ENOENT');
    await expect(readFile(retainedDigest, 'utf8')).resolves.toBe('existing digest');
  });

  it('rejects a digest naming another file', async () => {
    const candidate = await createCandidate();
    await writeFile(candidate.digestPath, `${'0'.repeat(64)}  other.tgz\n`);
    await expect(verifyReleaseCandidate(candidate)).rejects.toThrow('names a different file');
  });

  it('rejects altered tarball bytes', async () => {
    const candidate = await createCandidate();
    await writeFile(candidate.tarballPath, Buffer.from('altered'));
    await expect(verifyReleaseCandidate(candidate)).rejects.toThrow('SHA-256 does not match');
  });

  it.each([
    ['@evespace/other', '2.1.0', 'package name'],
    ['@evespace/esi-client', '2.2.0', 'does not match 2.1.0'],
  ])('rejects invalid embedded metadata', async (name, version, message) => {
    const candidate = await createCandidate({ name, version });
    await expect(verifyReleaseCandidate(candidate)).rejects.toThrow(message);
  });
});

async function createCandidate({
  name = '@evespace/esi-client',
  version = '2.1.0',
}: { readonly name?: string; readonly version?: string } = {}) {
  const directory = await makeTemporaryDirectory('esi-client-release-candidate-');
  const tarballPath = join(directory, 'package.tgz');
  const digestPath = `${tarballPath}.sha256`;
  const tarball = createTarball({
    'package/package.json': JSON.stringify({ name, version }),
    'package/dist/root.js': 'export {};\n',
  });
  const sha256 = createHash('sha256').update(tarball).digest('hex');
  await Promise.all([
    writeFile(tarballPath, tarball),
    writeFile(digestPath, `${sha256}  package.tgz\n`),
  ]);
  return { digestPath, expectedVersion: '2.1.0', tarballPath };
}
