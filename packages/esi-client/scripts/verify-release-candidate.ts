import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyReleaseCandidate } from './lib/release-candidate.ts';
import { parseReleaseTag } from './validate-release-metadata.ts';

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const tarballPath = resolve(requiredArgument('--tarball'));
  const digestPath = resolve(requiredArgument('--digest'));
  const tag = requiredArgument('--tag');
  const candidate = await verifyReleaseCandidate({
    digestPath,
    expectedVersion: parseReleaseTag(tag),
    tarballPath,
  });
  process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || value === undefined) throw new Error(`${name} requires a value`);
  return value;
}
