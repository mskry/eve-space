import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const minimumNpmVersion = [11, 5, 1] as const;

export function assertSupportedNpmVersion(version: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match === null) throw new Error(`npm returned an invalid stable version: ${version}`);

  const actual = match.slice(1).map(Number);
  for (const [index, minimum] of minimumNpmVersion.entries()) {
    if (actual[index] > minimum) return;
    if (actual[index] < minimum) {
      throw new Error(`npm ${version} is older than the required 11.5.1`);
    }
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const version = process.argv[2];
  if (version === undefined) throw new Error('Expected the installed npm version');
  assertSupportedNpmVersion(version);
}
