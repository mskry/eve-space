import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveCompatibilityDate, stageOpenApiSnapshot } from '../scripts/generate/openapi.ts';

const temporaryDirectories: string[] = [];
const validDocument = {
  info: { title: 'Test ESI', version: '1.0.0' },
  openapi: '3.1.0',
  paths: {},
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('compatibility date resolution', () => {
  it('prefers an explicit date over the environment and pinned file', async () => {
    const directory = await makeTemporaryDirectory();
    const pinnedDatePath = join(directory, 'compatibility-date.txt');
    await writeFile(pinnedDatePath, '2026-01-01\n');

    await expect(
      resolveCompatibilityDate({
        environment: { ESI_COMPATIBILITY_DATE: '2026-02-02' },
        pinnedDatePath,
        requestedDate: '2026-08-18',
      }),
    ).resolves.toBe('2026-08-18');
  });

  it('rejects impossible calendar dates', async () => {
    await expect(
      resolveCompatibilityDate({ environment: {}, requestedDate: '2026-02-30' }),
    ).rejects.toThrow('Invalid ESI compatibility date: 2026-02-30');
  });
});

describe('OpenAPI snapshot staging', () => {
  it('downloads, validates, normalizes, and hashes a specification in staging', async () => {
    const temporaryRoot = await makeTemporaryDirectory();
    let request;
    const staged = await stageOpenApiSnapshot({
      fetchImplementation: async (input, init) => {
        request = { input, init };
        return new Response(JSON.stringify(validDocument));
      },
      requestedDate: '2026-08-18',
      specificationUrl: 'https://example.test/openapi.json',
      temporaryRoot,
    });

    expect(request).toMatchObject({
      init: { headers: { accept: 'application/json', 'x-compatibility-date': '2026-08-18' } },
      input: 'https://example.test/openapi.json',
    });
    const snapshot = await readFile(staged.snapshotPath, 'utf8');
    expect(snapshot.indexOf('"info"')).toBeLessThan(snapshot.indexOf('"openapi"'));
    expect(staged.sha256).toBe(createHash('sha256').update(snapshot).digest('hex'));
    await expect(readFile(staged.provenancePath, 'utf8')).resolves.toContain(staged.sha256);

    await staged.cleanup();
    await expect(readdir(temporaryRoot)).resolves.toStrictEqual([]);
  });

  it('removes temporary output when retrieval fails', async () => {
    const temporaryRoot = await makeTemporaryDirectory();

    await expect(
      stageOpenApiSnapshot({
        fetchImplementation: async () => new Response('unavailable', { status: 503 }),
        requestedDate: '2026-08-18',
        temporaryRoot,
      }),
    ).rejects.toThrow('HTTP 503');
    await expect(readdir(temporaryRoot)).resolves.toStrictEqual([]);
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'esi-client-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
