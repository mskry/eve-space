import type { ExecFileOptions } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface NpmPackFile {
  readonly path: string;
  readonly size: number;
}

export interface NpmPackResult {
  readonly filename: string;
  readonly size: number;
  readonly unpackedSize: number;
  readonly entryCount?: number;
  readonly files: readonly NpmPackFile[];
}

const executeFile = promisify(execFile);
export const npmExecutable: string = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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

export async function npmPack(
  packageDirectory: string,
  destination: string,
): Promise<NpmPackResult[]> {
  const { stdout } = await execFileAsync(
    npmExecutable,
    ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    { cwd: packageDirectory },
  );
  return parseNpmPackJson(stdout);
}

export function parseNpmPackJson(stdout: string): NpmPackResult[] {
  let index = stdout.lastIndexOf('[');
  while (index >= 0) {
    try {
      const result = JSON.parse(stdout.slice(index).trim());
      if (Array.isArray(result) && result.length > 0) return result;
    } catch {
      // npm 10 may print lifecycle output before the final JSON payload.
    }
    if (index === 0) break;
    index = stdout.lastIndexOf('[', index - 1);
  }
  throw new Error('npm pack did not produce a JSON result');
}
