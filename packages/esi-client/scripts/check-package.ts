import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { packPackage } from './lib/package-pack.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const attwCli = fileURLToPath(
  new URL('./index.js', import.meta.resolve('@arethetypeswrong/cli/internal/getExitCode')),
);
const publintCli = fileURLToPath(new URL('./cli.js', import.meta.resolve('publint')));
const tsdownCli = fileURLToPath(import.meta.resolve('tsdown/run'));

export const packageValidationSteps = Object.freeze([
  'publint',
  'attw',
  'smoke:package',
  'pack:inspect',
] as const);

export interface RetainedPackage {
  readonly digestPath: string;
  readonly sha256: string;
  readonly tarballPath: string;
}

export async function checkPackage({
  built = false,
  retainDirectory,
}: {
  readonly built?: boolean;
  readonly retainDirectory?: string;
} = {}): Promise<RetainedPackage | undefined> {
  if (!built) await run('build', process.execPath, [tsdownCli]);

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'esi-client-package-check-'));
  try {
    process.stdout.write('\n> package\nPacking built output once for all package checks.\n');
    const packed = await packPackage(root, temporaryDirectory);
    if (packed.length !== 1)
      throw new Error(`Expected one package tarball, received ${packed.length}`);
    const [pack] = packed;
    const tarball = join(temporaryDirectory, pack.filename);
    const packJson = join(temporaryDirectory, 'pack.json');
    await writeFile(packJson, JSON.stringify(pack));

    const commands: Record<
      (typeof packageValidationSteps)[number],
      readonly [string, readonly string[]]
    > = {
      publint: [process.execPath, [publintCli, '--strict', tarball]],
      attw: [process.execPath, [attwCli, tarball, '--profile', 'esm-only']],
      'smoke:package': [
        process.execPath,
        [join(root, 'scripts/smoke-package.ts'), '--tarball', tarball],
      ],
      'pack:inspect': [
        process.execPath,
        [join(root, 'scripts/inspect-pack.ts'), '--pack-json', packJson, '--tarball', tarball],
      ],
    };

    for (const name of packageValidationSteps) {
      const [command, arguments_] = commands[name];
      await run(name, command, arguments_);
    }

    if (retainDirectory !== undefined) {
      return retainPackage(tarball, retainDirectory);
    }
    return undefined;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export async function retainPackage(
  tarball: string,
  destination: string,
): Promise<RetainedPackage> {
  await mkdir(destination, { recursive: true });
  const tarballPath = join(destination, 'package.tgz');
  const digestPath = `${tarballPath}.sha256`;
  let tarballCreated = false;
  let digestCreated = false;
  try {
    await copyFile(tarball, tarballPath, constants.COPYFILE_EXCL);
    tarballCreated = true;
    const sha256 = createHash('sha256')
      .update(await readFile(tarballPath))
      .digest('hex');
    await writeFile(digestPath, `${sha256}  ${basename(tarballPath)}\n`, { flag: 'wx' });
    digestCreated = true;
    return { digestPath, sha256, tarballPath };
  } catch (error) {
    await Promise.all([
      tarballCreated ? rm(tarballPath, { force: true }) : Promise.resolve(),
      digestCreated ? rm(digestPath, { force: true }) : Promise.resolve(),
    ]);
    throw error;
  }
}

function run(name: string, command: string, arguments_: readonly string[]): Promise<void> {
  process.stdout.write(`\n> ${name}\n${command} ${arguments_.join(' ')}\n`);
  return new Promise((resolvePromise, reject) => {
    let output = '';
    const child = spawn(command, arguments_, {
      cwd: root,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        const details = output.trim();
        const processResult = signal ?? `exit code ${code}`;
        const outputDetails = details ? `\n\n${details}` : '';
        reject(new Error(`${name} failed with ${processResult}${outputDetails}`));
      }
    });
  });
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  try {
    await checkPackage({
      built: process.argv.includes('--built'),
      retainDirectory: argumentValue('--retain-directory'),
    });
  } catch (error) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(
        `::error title=Package validation failed::${escapeWorkflowData(message)}\n`,
      );
    }
    throw error;
  }
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  return resolve(value);
}

function escapeWorkflowData(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
