import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { packPackage, execFileAsync, pnpmExecutable } from './lib/package-pack.ts';
import { extractPackageTarball } from './lib/package-tarball.ts';

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly exports: Readonly<Record<string, unknown>>;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'esi-client-smoke-'));
const suppliedTarball = argumentValue('--tarball');
try {
  const packDirectory = join(temporaryDirectory, 'pack');
  const consumerDirectory = join(temporaryDirectory, 'consumer');
  await mkdir(consumerDirectory);

  let tarball = suppliedTarball;
  if (tarball === undefined) {
    await mkdir(packDirectory);
    const [{ filename }] = await packPackage(root, packDirectory);
    tarball = join(packDirectory, filename);
  }

  const metadataRoot = await extractPackageTarball(tarball, join(temporaryDirectory, 'metadata'));
  const packageJson: PackageJson = JSON.parse(
    await readFile(join(metadataRoot, 'package.json'), 'utf8'),
  );
  if (packageJson.version !== '3.1.0') {
    throw new Error(`Expected package version 3.1.0, received ${packageJson.version}`);
  }
  for (const subpath of ['./types', './zod']) {
    if (!Object.hasOwn(packageJson.exports, subpath)) {
      throw new Error(`Missing packed package export ${subpath}`);
    }
  }
  if (Object.hasOwn(packageJson.exports, './schemas')) {
    throw new Error('Legacy packed package export ./schemas remains');
  }
  const publicCodeSpecifiers = Object.entries(packageJson.exports)
    .filter(([, entry]) => typeof entry === 'object')
    .map(([subpath]) =>
      subpath === '.' ? packageJson.name : `${packageJson.name}${subpath.slice(1)}`,
    );
  const exportedDomains = Object.keys(packageJson.exports)
    .filter((subpath) => subpath.startsWith('./domains/'))
    .map((subpath) => subpath.slice('./domains/'.length))
    .toSorted(compareText);
  if (exportedDomains.length !== 39) {
    throw new Error(`Expected 39 packed domain exports, received ${exportedDomains.length}`);
  }
  const domainFactories = exportedDomains.map((domain) => ({
    domain,
    factoryName: `create${domain.split('-').map(capitalize).join('')}Client`,
  }));

  await writeFile(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ name: 'esi-client-smoke', private: true, type: 'module' }),
  );
  await execFileAsync(pnpmExecutable, ['add', '--ignore-scripts', tarball, 'zod@4.4.3'], {
    cwd: consumerDirectory,
  });

  const standaloneRuntimeSource = `import { createStatusClient } from '@evespace/esi-client/domains/status';

const requests = [];
const client = createStatusClient({
  baseUrl: 'https://example.test',
  requestTimeoutMs: 5_000,
  fetch: async (input, init) => {
    requests.push({ input, init });
    return new Response(JSON.stringify({
      players: 42,
      server_version: 'standalone-smoke',
      start_time: '2026-08-18T00:00:00Z',
      vip: false,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'standalone-request' },
    });
  },
});

if (typeof client.get !== 'function') throw new Error('Invalid standalone status domain');
const status = await client.get({ compatibilityDate: '2020-01-01' });
const response = await client.withMetadata().get({ compatibilityDate: '2020-01-01' });
if (requests.length !== 2) throw new Error('Standalone status did not make two requests');
for (const request of requests) {
  if (request.input !== 'https://example.test/status') throw new Error('Unexpected standalone URL');
  if (request.init.method !== 'GET') throw new Error('Unexpected standalone method');
  if (new Headers(request.init.headers).get('x-compatibility-date') !== '2020-01-01') {
    throw new Error('Missing standalone compatibility header');
  }
  if (!(request.init.signal instanceof AbortSignal)) {
    throw new Error('Missing standalone transport signal');
  }
}
if (status.players !== 42 || response.data.server_version !== 'standalone-smoke') {
  throw new Error('Unexpected standalone status result');
}
if (response.meta.status !== 200 || response.meta.requestId !== 'standalone-request') {
  throw new Error('Unexpected standalone status metadata');
}
`;
  if (/from ['"]@evespace\/esi-client['"]/u.test(standaloneRuntimeSource)) {
    throw new Error('Standalone runtime consumer must not import the package root');
  }
  await writeFile(
    join(consumerDirectory, 'status-standalone-runtime.mjs'),
    standaloneRuntimeSource,
  );
  await execFileAsync(process.execPath, ['status-standalone-runtime.mjs'], {
    cwd: consumerDirectory,
  });

  await writeFile(
    join(consumerDirectory, 'status-generic-parity.mjs'),
    `import { EsiClient } from '@evespace/esi-client';
import { createStatusClient } from '@evespace/esi-client/domains/status';

const requests = [];
const fetch = async (input, init) => {
  requests.push({
    input,
    method: init.method,
    headers: Object.fromEntries(new Headers(init.headers)),
    body: init.body,
  });
  return new Response(JSON.stringify({
    players: 42,
    server_version: 'parity-smoke',
    start_time: '2026-08-18T00:00:00Z',
    vip: false,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const options = {
  baseUrl: 'https://example.test',
  compatibilityDate: '2020-01-01',
  fetch,
};
const curated = await createStatusClient(options).get();
const generic = await new EsiClient(options).callOperation('GetStatus', {});
if (JSON.stringify(curated) !== JSON.stringify(generic.data)) {
  throw new Error('Curated and generic status results differ');
}
if (requests.length !== 2 || JSON.stringify(requests[0]) !== JSON.stringify(requests[1])) {
  throw new Error('Curated and stable-ID generic status requests differ');
}
`,
  );
  await execFileAsync(process.execPath, ['status-generic-parity.mjs'], { cwd: consumerDirectory });

  await writeFile(
    join(consumerDirectory, 'runtime-smoke.mjs'),
    `import * as sdk from '@evespace/esi-client';
import {
  DEFAULT_ESI_REQUEST_TIMEOUT_MS,
  EsiClient,
  EsiHttpError,
  EsiNotModifiedError,
  EsiTransportError,
  classifyEsiFailure,
} from '@evespace/esi-client';
import * as operations from '@evespace/esi-client/operations';
import { describeOperation, operationManifest, operationRegistry, searchOperations } from '@evespace/esi-client/operations';
import { zGetStatusResponse } from '@evespace/esi-client/zod';

for (const specifier of ${JSON.stringify(publicCodeSpecifiers)}) await import(specifier);
const packageMetadata = (await import('@evespace/esi-client/package.json', { with: { type: 'json' } })).default;
if (packageMetadata.name !== '@evespace/esi-client') throw new Error('Invalid package metadata export');
if (packageMetadata.version !== '3.1.0') throw new Error('Invalid package metadata version');
if (Object.keys(operationRegistry).length !== 233) throw new Error('Incomplete operation registry');
if (operationManifest.operations.length !== 233) throw new Error('Incomplete operation manifest');
JSON.stringify(operationManifest);
const searchResults = searchOperations({
  domain: 'market',
  method: 'GET',
  authenticated: false,
  classification: 'read',
});
if (searchResults.length === 0 || searchResults.length > 20) {
  throw new Error('Invalid installed operation search results');
}
if (!Object.isFrozen(searchResults) || !Object.isFrozen(searchResults[0])) {
  throw new Error('Mutable installed operation search results');
}
const statusDescription = describeOperation('GetStatus');
if (statusDescription.http.method !== 'GET' || statusDescription.http.path !== '/status') {
  throw new Error('Invalid installed operation description');
}
if (!Object.isFrozen(statusDescription) || !Object.isFrozen(statusDescription.responses)) {
  throw new Error('Mutable installed operation description');
}
if (JSON.parse(JSON.stringify(statusDescription)).operationId !== 'GetStatus') {
  throw new Error('Non-serializable installed operation description');
}
if (statusDescription.rateLimit.kind !== 'declared' || statusDescription.rateLimit.group !== 'status') {
  throw new Error('Missing installed operation protocol facts');
}
if (operationRegistry.GetStatus.transport.protocol.rateLimit.group !== 'status') {
  throw new Error('Missing installed executable descriptor protocol facts');
}
if (!searchOperations({ query: 'GetStatus', limit: 1 })[0]?.protocol) {
  throw new Error('Missing installed operation search protocol facts');
}
try {
  describeOperation('getstatus');
  throw new Error('Unknown installed operation did not fail');
} catch (error) {
  if (error.code !== 'ESI_UNKNOWN_OPERATION') throw error;
  if (error.toJSON().operationId !== 'getstatus') throw new Error('Unsafe unknown-operation JSON');
}
void operations;

let request;
const client = new EsiClient({
  baseUrl: 'https://example.test',
  fetch: async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({
      players: 42,
      server_version: 'smoke',
      start_time: '2026-08-18T00:00:00Z',
      vip: false,
    }), {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=30',
        'content-type': 'application/json',
        'retry-after': '4',
        'x-ratelimit-group': 'status',
        'x-ratelimit-limit': '600',
        'x-ratelimit-remaining': '599',
        'x-ratelimit-used': '1',
      },
    });
  },
});
if (client.configuration.requestTimeoutMs !== DEFAULT_ESI_REQUEST_TIMEOUT_MS) {
  throw new Error('Invalid installed default request timeout');
}
if (typeof client.status.get !== 'function') throw new Error('Missing status domain');
const status = await client.status.get({ compatibilityDate: '2020-01-01' });
if (request.input !== 'https://example.test/status') throw new Error('Unexpected request URL');
if (request.init.method !== 'GET') throw new Error('Unexpected request method');
if (new Headers(request.init.headers).get('x-compatibility-date') !== '2020-01-01') {
  throw new Error('Missing compatibility header');
}
const metadataStatus = await client.status.withMetadata().get();
if (status.players !== 42 || status.server_version !== 'smoke') {
  throw new Error('Unexpected JSON-native response');
}
if (
  metadataStatus.meta.cache?.maxAgeSeconds !== 30 ||
  metadataStatus.meta.retryAfterSeconds !== 4 ||
  metadataStatus.meta.routeRateLimit?.remaining !== 599
) {
  throw new Error('Missing installed normalized response metadata');
}
zGetStatusResponse.parse(status);
if (typeof EsiHttpError !== 'function') throw new Error('Missing structured error export');
let notModified;
try {
  await new EsiClient({
    baseUrl: 'https://example.test',
    fetch: async () => new Response(null, { status: 304, headers: { etag: 'status-v1' } }),
  }).status.get({ ifNoneMatch: 'status-v1' });
} catch (error) {
  notModified = error;
}
if (!(notModified instanceof EsiNotModifiedError) || classifyEsiFailure(notModified) !== 'not-modified') {
  throw new Error('Invalid installed not-modified outcome');
}
let timeout;
let timeoutSignal;
try {
  await new EsiClient({
    baseUrl: 'https://example.test',
    requestTimeoutMs: 1,
    fetch: async (_input, init) => {
      timeoutSignal = init.signal;
      return new Promise(() => undefined);
    },
  }).callOperation('GetStatus', {});
} catch (error) {
  timeout = error;
}
if (
  !(timeout instanceof EsiTransportError) ||
  timeout.reason !== 'timeout' ||
  classifyEsiFailure(timeout) !== 'transient' ||
  !timeoutSignal?.aborted
) {
  throw new Error('Invalid installed timeout outcome');
}
if ('Configuration' in sdk || 'StatusApi' in sdk) throw new Error('Prototype exports remain');
`,
  );
  await execFileAsync(process.execPath, ['runtime-smoke.mjs'], { cwd: consumerDirectory });

  const factoryTypeSource = `${domainFactories
    .map(({ domain, factoryName }) => {
      const extra = domainFactoryTypeImports(domain);
      return `import { ${factoryName}${extra} } from '@evespace/esi-client/domains/${domain}';`;
    })
    .join('\n')}
// @ts-expect-error EsiClientConfiguration is internal and is not a domain export.
import type { EsiClientConfiguration } from '@evespace/esi-client/domains/status';
// @ts-expect-error Method-derived option names are not exported.
import type { GetOptions } from '@evespace/esi-client/domains/status';
// @ts-expect-error Domain/method-derived option names are not exported.
import type { StatusGetOptions } from '@evespace/esi-client/domains/status';

const options = { baseUrl: 'https://example.test', fetch: async () => new Response() };
${domainFactories
  .map(
    ({ domain, factoryName }) => `const ${domain.replaceAll('-', '_')} = ${factoryName}(options);`,
  )
  .join('\n')}

const statusOptions: GetStatusOptions = { compatibilityDate: '2026-08-18' };
const statusClient: StatusDomainClient = status;
const statusResult = statusClient.get(statusOptions);
// @ts-expect-error The raw operation-ID transliteration was replaced by get.
statusClient.getStatus();

const locationOptions: GetCharactersCharacterIdLocationOptions = {};
const locationResult = location.get(90000001, locationOptions);
// @ts-expect-error The raw operation-ID transliteration was replaced by get.
location.getCharactersCharacterIdLocation(90000001);

void statusResult;
void locationResult;
`;
  if (/from ['"]@evespace\/esi-client['"]/u.test(factoryTypeSource)) {
    throw new Error('Domain factory type consumer must not import the package root');
  }
  await writeFile(join(consumerDirectory, 'domain-factories-smoke.ts'), factoryTypeSource);

  await writeFile(
    join(consumerDirectory, 'types-smoke.ts'),
    `${publicCodeSpecifiers
      .map(
        (specifier, index) =>
          `import type * as PublicExport${index} from ${JSON.stringify(specifier)};`,
      )
      .join('\n')}
import {
  EsiNotModifiedError,
  EsiTransportError,
  EsiClient,
  EsiHttpError,
  classifyEsiFailure,
  type EsiClientConfiguration,
  type EsiClientOptions,
  type EsiFailureClassification,
  type EsiResponse,
  type EsiResponseMetadata,
  type SerializedEsiClientConfiguration,
  type SerializedEsiNotModifiedError,
  type SerializedEsiTransportError,
} from '@evespace/esi-client';
import {
  describeOperation,
  operationManifest,
  operationRegistry,
  searchOperations,
  type ExecutableOperationRegistry,
  type OperationExecutionDescriptor,
  type OperationProtocolDescriptor,
  type OperationSearchProtocol,
  type OperationSearchResult,
  type SerializableOperationManifestEntry,
  type SerializableOperationManifest,
  type SearchOperationsOptions,
} from '@evespace/esi-client/operations';
import {
  type GetStatusResponse,
} from '@evespace/esi-client/types';
import { zGetStatusResponse } from '@evespace/esi-client/zod';
import {
  createStatusClient,
  type StatusDomainClient,
  type GetStatusOptions,
} from '@evespace/esi-client/domains/status';

const options: EsiClientOptions = { compatibilityDate: '2026-08-18', requestTimeoutMs: 30_000 };
const client = new EsiClient(options);
const configuration: EsiClientConfiguration = client.configuration;
const serializedConfiguration: SerializedEsiClientConfiguration = configuration.toJSON();
const domain: StatusDomainClient = client.status;
const status: Promise<GetStatusResponse> = domain.get();
const statusOptions: GetStatusOptions = { compatibilityDate: '2026-08-18' };
const standaloneDomain: StatusDomainClient = createStatusClient(options);
const standaloneStatus: Promise<GetStatusResponse> = standaloneDomain.get(statusOptions);
const parsed: GetStatusResponse = zGetStatusResponse.parse({
  players: 1,
  server_version: 'smoke',
  start_time: '2026-08-18T00:00:00Z',
  vip: false,
});
type StatusEnvelope = EsiResponse<GetStatusResponse>;
type Descriptor = OperationExecutionDescriptor;
type Protocol = OperationProtocolDescriptor;
type SearchProtocol = OperationSearchProtocol;
type Failure = EsiFailureClassification;
type Metadata = EsiResponseMetadata;
type TransportJson = SerializedEsiTransportError;
type NotModifiedJson = SerializedEsiNotModifiedError;
const registry: ExecutableOperationRegistry = operationRegistry;
const manifest: SerializableOperationManifest = operationManifest;
const searchOptions: SearchOperationsOptions = { query: 'market', limit: 20 };
const searchResults: readonly OperationSearchResult[] = searchOperations(searchOptions);
const description: SerializableOperationManifestEntry = describeOperation('GetStatus');
const errorConstructor: typeof EsiHttpError = EsiHttpError;
const transportErrorConstructor: typeof EsiTransportError = EsiTransportError;
const notModifiedErrorConstructor: typeof EsiNotModifiedError = EsiNotModifiedError;
const classification: EsiFailureClassification = classifyEsiFailure(new Error('unknown'));
void status;
void standaloneStatus;
void parsed;
void errorConstructor;
void transportErrorConstructor;
void notModifiedErrorConstructor;
void classification;
void (undefined as StatusEnvelope | undefined);
void (undefined as Descriptor | undefined);
void (undefined as Protocol | SearchProtocol | Failure | Metadata | TransportJson | NotModifiedJson | undefined);
void registry;
void manifest;
void searchResults;
void description;
void serializedConfiguration;
${publicCodeSpecifiers
  .map((_, index) => `void (undefined as typeof PublicExport${index} | undefined);`)
  .join('\n')}
`,
  );
  await writeFile(
    join(consumerDirectory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        strict: true,
        target: 'ES2022',
      },
      include: ['domain-factories-smoke.ts', 'types-smoke.ts'],
    }),
  );
  await execFileAsync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
    { cwd: consumerDirectory },
  );

  const browserEntry = join(consumerDirectory, 'browser-entry.mjs');
  await writeFile(
    browserEntry,
    `import { EsiClient } from '@evespace/esi-client';
import { zGetStatusResponse } from '@evespace/esi-client/zod';
export const client = new EsiClient({ baseUrl: 'https://example.test' });
export const statusSchema = zGetStatusResponse;
`,
  );
  await build({
    absWorkingDir: consumerDirectory,
    bundle: true,
    entryPoints: [browserEntry],
    format: 'esm',
    logLevel: 'silent',
    outfile: join(consumerDirectory, 'browser-bundle.js'),
    platform: 'browser',
    target: 'es2022',
  });
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}

function domainFactoryTypeImports(domain: string): string {
  if (domain === 'status') return ', type StatusDomainClient, type GetStatusOptions';
  if (domain === 'location') return ', type GetCharactersCharacterIdLocationOptions';
  return '';
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  return resolve(value);
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
