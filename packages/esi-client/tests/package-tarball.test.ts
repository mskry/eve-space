import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { extractPackageTarball } from '../scripts/lib/package-tarball.ts';
import { createTarball } from './helpers/tarball.js';
import { makeTemporaryDirectory } from './helpers/temporary-directory.js';

it('extracts package contents from the supplied tarball', async () => {
  const directory = await makeTemporaryDirectory('esi-client-tarball-');
  const tarball = join(directory, 'package.tgz');
  await writeFile(
    tarball,
    createTarball({
      'package/package.json': '{"name":"fixture"}\n',
      'package/dist/index.js': 'export const source = "tarball";\n',
    }),
  );

  const packageRoot = await extractPackageTarball(tarball, join(directory, 'extracted'));

  await expect(readFile(join(packageRoot, 'package.json'), 'utf8')).resolves.toBe(
    '{"name":"fixture"}\n',
  );
  await expect(readFile(join(packageRoot, 'dist/index.js'), 'utf8')).resolves.toBe(
    'export const source = "tarball";\n',
  );
});
