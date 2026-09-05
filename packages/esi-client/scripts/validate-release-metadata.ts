import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { execFileAsync } from './lib/package-pack.ts';

export const releasePackageName = '@evespace/esi-client';

export interface ReleaseMetadata {
  readonly commit: string;
  readonly packageName: typeof releasePackageName;
  readonly tag: string;
  readonly version: string;
}

export interface ReleaseMetadataOptions {
  readonly fetchRegistry?: typeof fetch;
  readonly repositoryRoot?: string;
  readonly runGit?: (arguments_: readonly string[]) => Promise<string>;
  readonly tag: string;
}

const defaultRepositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function parseReleaseTag(tag: string): string {
  const match = /^@evespace\/esi-client@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(tag);
  if (match === null) {
    throw new Error(
      `Release tag must match @evespace/esi-client@<stable-version>; received ${JSON.stringify(tag)}`,
    );
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export async function validateReleaseMetadata({
  fetchRegistry = fetch,
  repositoryRoot = defaultRepositoryRoot,
  runGit = async (arguments_) =>
    (await execFileAsync('git', arguments_, { cwd: repositoryRoot })).stdout.trim(),
  tag,
}: ReleaseMetadataOptions): Promise<ReleaseMetadata> {
  const version = parseReleaseTag(tag);
  const packageJson: { readonly name?: unknown; readonly version?: unknown } = JSON.parse(
    await readFile(join(repositoryRoot, 'packages/esi-client/package.json'), 'utf8'),
  );
  if (packageJson.name !== releasePackageName) {
    throw new Error(`Release package must be ${releasePackageName}`);
  }
  if (typeof packageJson.version !== 'string') {
    throw new Error('Release package version must be a string');
  }
  if (packageJson.version !== version) {
    throw new Error(
      `Release tag version ${version} does not match package version ${packageJson.version}`,
    );
  }

  const changelog = await readFile(
    join(repositoryRoot, 'packages/esi-client/CHANGELOG.md'),
    'utf8',
  );
  const changelogHeading = new RegExp(
    `^## ${version.replaceAll('.', '\\.')} - \\d{4}-\\d{2}-\\d{2}$`,
    'gmu',
  );
  if ([...changelog.matchAll(changelogHeading)].length !== 1) {
    throw new Error(`CHANGELOG.md must contain exactly one release heading for ${version}`);
  }

  const tagReference = `refs/tags/${tag}`;
  const objectType = await runGit(['cat-file', '-t', tagReference]);
  if (objectType !== 'tag') throw new Error(`Release tag ${tag} must be annotated`);
  const commit = await runGit(['rev-parse', `${tagReference}^{}`]);
  const head = await runGit(['rev-parse', 'HEAD']);
  if (commit !== head) throw new Error(`Release tag ${tag} must identify the checked-out commit`);
  try {
    await runGit(['merge-base', '--is-ancestor', commit, 'origin/main']);
  } catch {
    throw new Error(`Release commit ${commit} is not contained in origin/main`);
  }

  const response = await fetchRegistry(
    `https://registry.npmjs.org/${encodeURIComponent(releasePackageName)}`,
    { headers: { accept: 'application/json' } },
  );
  if (!response.ok) {
    throw new Error(`npm registry metadata request failed with status ${response.status}`);
  }
  const registryDocument: unknown = await response.json();
  if (
    registryDocument === null ||
    typeof registryDocument !== 'object' ||
    !('versions' in registryDocument) ||
    registryDocument.versions === null ||
    typeof registryDocument.versions !== 'object'
  ) {
    throw new Error('npm registry returned invalid package metadata');
  }
  if (Object.hasOwn(registryDocument.versions, version)) {
    throw new Error(`${releasePackageName}@${version} is already published`);
  }

  return { commit, packageName: releasePackageName, tag, version };
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const tag = argumentValue('--tag') ?? process.env.GITHUB_REF_NAME;
  if (tag === undefined) throw new Error('--tag or GITHUB_REF_NAME is required');
  const metadata = await validateReleaseMetadata({ tag });
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  return value;
}
