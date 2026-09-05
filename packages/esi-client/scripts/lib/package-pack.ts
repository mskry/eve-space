import type { ExecFileOptions } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { extractPackageTarball } from './package-tarball.ts';

export interface PackagePackFile {
  readonly path: string;
  readonly size: number;
}

export interface PackagePackResult {
  readonly filename: string;
  readonly size: number;
  readonly unpackedSize: number;
  readonly entryCount?: number;
  readonly files: readonly PackagePackFile[];
}

const executeFile = promisify(execFile);
export const pnpmExecutable: string = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export function usesWindowsCommandShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && /\.(?:cmd|bat)$/iu.test(command);
}

export function execFileAsync(
  command: string,
  arguments_: readonly string[],
  options: Omit<ExecFileOptions, 'encoding'> = {},
): Promise<{ stdout: string; stderr: string }> {
  return executeFile(command, arguments_, {
    ...options,
    encoding: 'utf8',
    shell: options.shell ?? usesWindowsCommandShell(command),
  });
}

export async function packPackage(
  packageDirectory: string,
  destination: string,
): Promise<PackagePackResult[]> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'esi-client-pack-metadata-'));
  const output = join(destination, 'evespace-esi-client-%v.tgz');
  const { stdout } = await execFileAsync(
    pnpmExecutable,
    ['--config.ignore-scripts=true', 'pack', '--json', '--out', output],
    { cwd: packageDirectory },
  );
  const packed = parsePnpmPackJson(stdout);
  const tarball = resolve(packageDirectory, packed.filename);
  const expectedDirectory = resolve(destination);
  if (resolve(tarball, '..') !== expectedDirectory) {
    throw new Error(`pnpm pack wrote outside the requested directory: ${tarball}`);
  }

  try {
    const packageRoot = await extractPackageTarball(tarball, temporaryDirectory);
    const files = await collectPackedFiles(packageRoot);
    return [
      {
        filename: basename(tarball),
        size: (await stat(tarball)).size,
        unpackedSize: files.reduce((total, file) => total + file.size, 0),
        entryCount: files.length,
        files,
      },
    ];
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export function parsePnpmPackJson(stdout: string): {
  readonly filename: string;
  readonly name: string;
  readonly version: string;
} {
  let index = stdout.lastIndexOf('{');
  while (index >= 0) {
    try {
      const result = JSON.parse(stdout.slice(index).trim());
      if (
        result !== null &&
        typeof result === 'object' &&
        typeof result.filename === 'string' &&
        typeof result.name === 'string' &&
        typeof result.version === 'string'
      ) {
        return result;
      }
    } catch {
      // pnpm may print lifecycle output before the final JSON payload.
    }
    if (index === 0) break;
    index = stdout.lastIndexOf('{', index - 1);
  }
  throw new Error('pnpm pack did not produce a JSON result');
}

async function collectPackedFiles(directory: string, prefix = ''): Promise<PackagePackFile[]> {
  const files: PackagePackFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      files.push(...(await collectPackedFiles(join(directory, entry.name), path)));
    else if (entry.isFile())
      files.push({ path, size: (await stat(join(directory, entry.name))).size });
    else throw new Error(`Unsupported packed file type: ${path}`);
  }
  return files.toSorted((left, right) => left.path.localeCompare(right.path, 'en'));
}
