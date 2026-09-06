import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { extractPackageTarball } from './package-tarball.ts';
import { releasePackageName } from '../validate-release-metadata.ts';

export interface VerifiedReleaseCandidate {
  readonly packageName: typeof releasePackageName;
  readonly sha256: string;
  readonly tarballPath: string;
  readonly version: string;
}

export async function verifyReleaseCandidate({
  digestPath,
  expectedVersion,
  tarballPath,
}: {
  readonly digestPath: string;
  readonly expectedVersion: string;
  readonly tarballPath: string;
}): Promise<VerifiedReleaseCandidate> {
  for (const path of [tarballPath, digestPath]) {
    if (!(await stat(path)).isFile()) throw new Error(`Release candidate is not a file: ${path}`);
  }

  const digestSource = await readFile(digestPath, 'utf8');
  const match = /^([a-f0-9]{64}) {2}([^\r\n]+)\n?$/u.exec(digestSource);
  if (match === null || match[2] !== basename(tarballPath)) {
    throw new Error('Release candidate digest is malformed or names a different file');
  }
  const sha256 = createHash('sha256')
    .update(await readFile(tarballPath))
    .digest('hex');
  if (sha256 !== match[1]) throw new Error('Release candidate SHA-256 does not match');

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'esi-client-release-verify-'));
  try {
    const packageRoot = await extractPackageTarball(tarballPath, temporaryDirectory);
    const packageJson: { readonly name?: unknown; readonly version?: unknown } = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8'),
    );
    if (packageJson.name !== releasePackageName) {
      throw new Error(`Release candidate package name must be ${releasePackageName}`);
    }
    if (typeof packageJson.version !== 'string') {
      throw new TypeError('Release candidate package version must be a string');
    }
    if (packageJson.version !== expectedVersion) {
      throw new Error(
        `Release candidate version ${packageJson.version} does not match ${expectedVersion}`,
      );
    }
    return { packageName: releasePackageName, sha256, tarballPath, version: expectedVersion };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
