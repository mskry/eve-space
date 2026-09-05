import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '@scalar/openapi-parser';

export interface CompatibilityDateOptions {
  requestedDate?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  pinnedDatePath?: string;
}

export interface StageOpenApiSnapshotOptions extends CompatibilityDateOptions {
  fetchImplementation?: typeof fetch;
  specificationUrl?: string;
  temporaryRoot?: string;
  signal?: AbortSignal;
}

export interface StagedOpenApiSnapshot {
  readonly compatibilityDate: string;
  readonly directory: string;
  readonly document: Readonly<Record<string, unknown>>;
  readonly provenancePath: string;
  readonly sha256: string;
  readonly snapshotPath: string;
  cleanup(): Promise<void>;
}

export const defaultSpecificationUrl = 'https://esi.evetech.net/meta/openapi.json';
export const pinnedCompatibilityDatePath: string = fileURLToPath(
  new URL('../../openapi/compatibility-date.txt', import.meta.url),
);

const compatibilityDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function resolveCompatibilityDate(
  options: CompatibilityDateOptions = {},
): Promise<string> {
  const {
    requestedDate,
    environment = process.env,
    pinnedDatePath = pinnedCompatibilityDatePath,
  } = options;
  const pinnedDate = requestedDate ?? environment.ESI_COMPATIBILITY_DATE;
  const compatibilityDate = (pinnedDate ?? (await readFile(pinnedDatePath, 'utf8'))).trim();

  if (!compatibilityDatePattern.test(compatibilityDate)) {
    throw new Error(`Invalid ESI compatibility date: ${compatibilityDate}`);
  }
  const parsedDate = new Date(`${compatibilityDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.valueOf()) ||
    parsedDate.toISOString().slice(0, 10) !== compatibilityDate
  ) {
    throw new Error(`Invalid ESI compatibility date: ${compatibilityDate}`);
  }
  return compatibilityDate;
}

export async function stageOpenApiSnapshot(
  options: StageOpenApiSnapshotOptions = {},
): Promise<StagedOpenApiSnapshot> {
  const {
    fetchImplementation = globalThis.fetch,
    specificationUrl = defaultSpecificationUrl,
    temporaryRoot = tmpdir(),
  } = options;
  const compatibilityDate = await resolveCompatibilityDate(options);
  const stageDirectory = await mkdtemp(join(temporaryRoot, 'esi-client-openapi-'));

  try {
    const response = await fetchImplementation(specificationUrl, {
      headers: {
        accept: 'application/json',
        'x-compatibility-date': compatibilityDate,
      },
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to retrieve ESI OpenAPI specification: HTTP ${response.status}`);
    }

    const source = await response.text();
    let document: Record<string, unknown>;
    try {
      document = JSON.parse(source);
    } catch (error) {
      throw new Error('Failed to parse ESI OpenAPI specification as JSON', { cause: error });
    }

    const validation = await validate(document);
    if (!validation.valid) {
      const details = validation.errors.map(({ message, path }) => {
        const location = path?.length ? ` at ${path.join('.')}` : '';
        return `${message}${location}`;
      });
      throw new Error(`Invalid ESI OpenAPI specification: ${details.join('; ')}`);
    }
    if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3.1.')) {
      const receivedVersion = describeValue(document.openapi);
      throw new Error(`Expected an OpenAPI 3.1 specification, received ${receivedVersion}`);
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- sortJsonValue only reorders keys, preserving the JSON shape
    const normalizedDocument = sortJsonValue(document) as Readonly<Record<string, unknown>>;
    const snapshot = `${JSON.stringify(normalizedDocument, null, 2)}\n`;
    const sha256 = createHash('sha256').update(snapshot).digest('hex');
    const provenance = `${JSON.stringify(
      {
        compatibilityDate,
        specificationUrl,
        sha256,
      },
      null,
      2,
    )}\n`;
    const snapshotPath = join(stageDirectory, 'esi-openapi.json');
    const provenancePath = join(stageDirectory, 'provenance.json');
    await writeFile(snapshotPath, snapshot);
    await writeFile(provenancePath, provenance);

    return Object.freeze({
      compatibilityDate,
      directory: stageDirectory,
      document: normalizedDocument,
      provenancePath,
      sha256,
      snapshotPath,
      async cleanup() {
        await rm(stageDirectory, { force: true, recursive: true });
      },
    });
  } catch (error) {
    await rm(stageDirectory, { force: true, recursive: true });
    throw error;
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      })
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return 'unknown';
}
