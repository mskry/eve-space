import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkPackage } from './check-package.ts';
import { pnpmExecutable } from './lib/package-pack.ts';

export const releaseCandidateSteps = Object.freeze([
  'generate:check',
  'docs:check',
  'format:check',
  'lint',
  'typecheck',
  'test:coverage',
  'examples:check',
  'build',
] as const);

export async function createReleaseCandidate(outputDirectory: string): Promise<void> {
  const resolvedOutputDirectory = resolve(outputDirectory);
  await mkdir(resolvedOutputDirectory);
  for (const step of releaseCandidateSteps) await runPnpm(step);
  const retainedPackage = await checkPackage({
    built: true,
    retainDirectory: resolvedOutputDirectory,
  });
  if (retainedPackage === undefined) throw new Error('Release candidate was not retained');
  process.stdout.write(`${JSON.stringify(retainedPackage, null, 2)}\n`);
}

function runPnpm(script: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(pnpmExecutable, [script], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        const reason = signal ?? `exit code ${code}`;
        reject(new Error(`${script} failed with ${reason}`));
      }
    });
  });
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || value === undefined) throw new Error(`${name} requires a value`);
  return value;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await createReleaseCandidate(requiredArgument('--output-directory'));
}
