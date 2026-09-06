import { readFile } from 'node:fs/promises';

import type { NormalizedOpenApiModel, NormalizedOperation } from './normalize.ts';
import { operationSchemaName } from './operation-names.ts';
import { assertRecord, rejectUnknownKeys } from './internal/guards.ts';
import {
  domainSymbolNames,
  facadeMemberPattern,
  reservedIdentifiers,
  splitWords,
} from './internal/facade-naming.ts';
import { deepFreeze } from './internal/json.ts';
import { capitalize, compareText } from './internal/text.ts';
import { resolveConfigPath } from './paths.ts';

export type OperationSafetyClassification = 'read' | 'mutation';

export interface FacadeCatalogEntry {
  readonly operationId: string;
  readonly domain: string;
  readonly method: string;
  readonly reviewed: true;
  readonly note?: string;
}

export interface OperationSafetyOverride {
  readonly operationId: string;
  readonly classification: 'read';
  readonly reason: string;
  readonly reviewed: true;
}

export interface ResolvedOperationMetadata {
  readonly operationId: string;
  readonly domain: string;
  readonly method: string;
  readonly classification: OperationSafetyClassification;
  readonly safetyOverrideReason: string | null;
}

export interface OperationMetadataOptions {
  facadeCatalogPath?: string;
  safetyOverridesPath?: string;
  /** Reuse a catalog already loaded by the caller instead of reading the file again. */
  facadeCatalog?: readonly FacadeCatalogEntry[];
}

interface FacadeCatalogConfig {
  readonly [key: string]: unknown;
  readonly schemaVersion: number;
  readonly operations: readonly Record<string, unknown>[];
}

interface SafetyOverridesConfig {
  readonly [key: string]: unknown;
  readonly schemaVersion: number;
  readonly overrides: readonly Record<string, unknown>[];
}

export const defaultFacadeCatalogPath: string = resolveConfigPath('facadeCatalog');
export const defaultSafetyOverridesPath: string = resolveConfigPath('safetyOverrides');

const reservedFacadeMembers = new Set([
  ...reservedIdentifiers,
  'callOperation',
  'configuration',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
  'withMetadata',
]);
const httpMethodWords = new Set([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'trace',
]);

export async function loadFacadeCatalog(
  model: NormalizedOpenApiModel,
  path: string = defaultFacadeCatalogPath,
): Promise<readonly FacadeCatalogEntry[]> {
  return parseFacadeCatalog(model, await readFile(path, 'utf8'), path);
}

/**
 * Builds the catalog from source that has already been read, so one read can back the emitted
 * metadata, the naming review report, and the provenance hash that attests to them.
 */
export function parseFacadeCatalog(
  model: NormalizedOpenApiModel,
  source: string,
  path: string = defaultFacadeCatalogPath,
): readonly FacadeCatalogEntry[] {
  const config = parseFacadeCatalogConfig(source, path);
  const operationIds = operationIdSet(model);
  const seen = new Set<string>();
  let previousOperationId: string | undefined;
  const catalog: FacadeCatalogEntry[] = config.operations.map((entry, index) => {
    assertRecord(entry, `Facade catalog entry ${index}`);
    rejectUnknownKeys(
      entry,
      new Set(['domain', 'method', 'note', 'operationId', 'reviewed']),
      `facade catalog entry ${index}`,
    );
    const operationId = requiredString(
      entry.operationId,
      `Facade catalog entry ${index} operationId`,
    );
    if (seen.has(operationId)) throw new Error(`Duplicate facade catalog entry: ${operationId}`);
    seen.add(operationId);
    if (!operationIds.has(operationId))
      throw new Error(`Stale facade catalog entry: ${operationId}`);
    if (previousOperationId !== undefined && previousOperationId > operationId) {
      throw new Error(
        `Facade catalog entries must be sorted by operationId: ${previousOperationId} before ${operationId}`,
      );
    }
    previousOperationId = operationId;
    if (entry.reviewed !== true) {
      throw new Error(`Facade catalog entry is not reviewed: ${operationId}`);
    }
    const domain = validFacadeIdentifier(entry.domain, 'domain', operationId);
    const method = validFacadeIdentifier(entry.method, 'method', operationId);
    const note = Object.hasOwn(entry, 'note')
      ? requiredString(entry.note, `Facade catalog note for ${operationId}`)
      : undefined;
    return note === undefined
      ? { domain, method, operationId, reviewed: true as const }
      : { domain, method, note, operationId, reviewed: true as const };
  });
  const missing = [...operationIds]
    .filter((operationId) => !seen.has(operationId))
    .toSorted(compareText);
  if (missing.length > 0) throw new Error(`Missing facade catalog entries: ${missing.join(', ')}`);
  validateFacadeCatalog(model, catalog);
  return deepFreeze(catalog);
}

export async function loadSafetyOverrides(
  model: NormalizedOpenApiModel,
  path: string = defaultSafetyOverridesPath,
): Promise<readonly OperationSafetyOverride[]> {
  const config = await readConfig(path, 'operation safety overrides');
  const operationsById = new Map(
    model.operations.map((operation) => [operation.operationId, operation]),
  );
  const seen = new Set<string>();
  const overrides: OperationSafetyOverride[] = config.overrides.map((entry, index) => {
    assertRecord(entry, `Operation safety override ${index}`);
    rejectUnknownKeys(
      entry,
      new Set(['classification', 'operationId', 'reason', 'reviewed']),
      `operation safety override ${index}`,
    );
    const operationId = requiredString(
      entry.operationId,
      `Operation safety override ${index} operationId`,
    );
    rejectDuplicateOrStale(
      operationId,
      seen,
      new Set(operationsById.keys()),
      'operation safety override',
    );
    if (entry.reviewed !== true) {
      throw new Error(`Operation safety override is not reviewed: ${operationId}`);
    }
    if (entry.classification !== 'read') {
      throw new Error(`Safety override for ${operationId} must classify the operation as read`);
    }
    const reason = requiredString(
      entry.reason,
      `Operation safety override reason for ${operationId}`,
    );
    const operation = operationsById.get(operationId);
    if (operation?.method !== 'POST') {
      throw new Error(
        `Read-like safety override is only valid for POST operations: ${operationId} is ${String(operation?.method)}`,
      );
    }
    return { classification: 'read' as const, operationId, reason, reviewed: true as const };
  });
  return deepFreeze(overrides.toSorted(compareOperationIds));
}

export async function resolveOperationMetadata(
  model: NormalizedOpenApiModel,
  options: OperationMetadataOptions = {},
): Promise<readonly ResolvedOperationMetadata[]> {
  const [facadeCatalog, safetyOverrides] = await Promise.all([
    options.facadeCatalog ?? loadFacadeCatalog(model, options.facadeCatalogPath),
    loadSafetyOverrides(model, options.safetyOverridesPath),
  ]);
  const namingById = new Map(facadeCatalog.map((entry) => [entry.operationId, entry]));
  const safetyById = new Map(safetyOverrides.map((entry) => [entry.operationId, entry]));

  const metadata: ResolvedOperationMetadata[] = model.operations.map((operation) => {
    const naming = namingById.get(operation.operationId);
    if (naming === undefined) {
      throw new Error(`Resolved facade catalog is missing operation: ${operation.operationId}`);
    }
    return {
      classification:
        operation.method === 'GET' || safetyById.has(operation.operationId) ? 'read' : 'mutation',
      domain: naming.domain,
      method: naming.method,
      operationId: operation.operationId,
      safetyOverrideReason: safetyById.get(operation.operationId)?.reason ?? null,
    };
  });
  return deepFreeze(metadata.toSorted(compareOperationIds));
}

/** Derives an unreviewed candidate domain for review tooling and synthetic tests only. */
export function defaultDomainName(operation: NormalizedOperation): string {
  const tagName = toIdentifier(operation.domainSource ?? '', '');
  if (tagName !== '') return safeDefaultIdentifier(tagName, 'domain');

  const words = splitWords(operation.operationId);
  if (httpMethodWords.has(words[0]?.toLowerCase())) words.shift();
  const operationDomain = words[0] ?? 'esi';
  return safeDefaultIdentifier(toIdentifier(operationDomain, 'esi'), 'domain');
}

/** Derives an unreviewed candidate method for review tooling and synthetic tests only. */
export function defaultMethodName(operationId: string): string {
  return safeDefaultIdentifier(toIdentifier(operationId, 'operation'), 'operation');
}

function parseFacadeCatalogConfig(source: string, path: string): FacadeCatalogConfig {
  const config = parseJsonConfig(source, path, 'facade catalog');
  rejectUnknownKeys(config, new Set(['operations', 'schemaVersion']), 'facade catalog config');
  assertFacadeCatalogConfig(config);
  return config;
}

function assertFacadeCatalogConfig(
  config: Record<string, unknown>,
): asserts config is FacadeCatalogConfig {
  if (config.schemaVersion !== 2 || !Array.isArray(config.operations)) {
    throw new Error('Invalid facade catalog config');
  }
}

async function readConfig(path: string, name: string): Promise<SafetyOverridesConfig> {
  const config = await readJsonConfig(path, name);
  rejectUnknownKeys(config, new Set(['overrides', 'schemaVersion']), `${name} config`);
  assertSafetyOverridesConfig(config, name);
  return config;
}

function assertSafetyOverridesConfig(
  config: Record<string, unknown>,
  name: string,
): asserts config is SafetyOverridesConfig {
  if (config.schemaVersion !== 1 || !Array.isArray(config.overrides)) {
    throw new Error(`Invalid ${name} config`);
  }
}

async function readJsonConfig(path: string, name: string): Promise<Record<string, unknown>> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${name} from ${path}`, { cause: error });
  }
  return parseJsonConfig(source, path, name);
}

function parseJsonConfig(source: string, path: string, name: string): Record<string, unknown> {
  let config: unknown;
  try {
    config = JSON.parse(source);
  } catch (error) {
    throw new Error(`Failed to read ${name} from ${path}`, { cause: error });
  }
  assertRecord(config, `${name} config`);
  return config;
}

function operationIdSet(model: NormalizedOpenApiModel): Set<string> {
  if (model === null || typeof model !== 'object' || !Array.isArray(model.operations)) {
    throw new Error('Normalized OpenAPI model must contain operations');
  }
  return new Set(model.operations.map(({ operationId }) => operationId));
}

function rejectDuplicateOrStale(
  operationId: string,
  seen: Set<string>,
  operationIds: ReadonlySet<string>,
  name: string,
): void {
  if (seen.has(operationId)) throw new Error(`Duplicate ${name}: ${operationId}`);
  if (!operationIds.has(operationId)) throw new Error(`Stale or unknown ${name}: ${operationId}`);
  seen.add(operationId);
}

function validFacadeIdentifier(value: unknown, kind: string, operationId: string): string {
  const context = `Facade ${kind} for ${operationId}`;
  const identifier = requiredString(value, context);
  if (!facadeMemberPattern.test(identifier)) {
    throw new Error(`Invalid TypeScript identifier for ${context}: ${identifier}`);
  }
  if (!/^[a-z]/u.test(identifier)) {
    throw new Error(
      `Facade ${kind} must begin with a lowercase letter for ${operationId}: ${identifier}`,
    );
  }
  if (reservedFacadeMembers.has(identifier)) {
    throw new Error(`Reserved facade ${kind} for ${operationId}: ${identifier}`);
  }
  return identifier;
}

function validateFacadeCatalog(
  model: NormalizedOpenApiModel,
  catalog: readonly FacadeCatalogEntry[],
): void {
  const operationsById = new Map(
    model.operations.map((operation) => [operation.operationId, operation]),
  );
  const facadeNames = new Map<string, string>();
  const domains = new Map<string, string>();
  const optionNames = new Map<string, string>();

  for (const entry of catalog) {
    const facadeName = `${entry.domain}.${entry.method}`;
    rejectDerivedCollision(
      facadeNames,
      facadeName,
      entry.operationId,
      `Facade domain/method collision ${facadeName}`,
    );
    if (!domains.has(entry.domain)) domains.set(entry.domain, entry.operationId);

    const operation = operationsById.get(entry.operationId);
    if (operation !== undefined && operationHasOptions(operation)) {
      const optionsName = `${operationSchemaName(entry.operationId)}Options`;
      assertDerivedIdentifier(optionsName, 'options type', entry.operationId);
      rejectDerivedCollision(
        optionNames,
        optionsName,
        entry.operationId,
        `Facade options type collision: ${optionsName}`,
      );
    }
  }

  const files = new Map<string, string>();
  const classes = new Map<string, string>();
  const factories = new Map<string, string>();
  for (const [domain, operationId] of domains) {
    const { className, factoryName, fileName, metadataClassName } = domainSymbolNames(domain);
    assertDerivedIdentifier(className, 'domain class', operationId);
    assertDerivedIdentifier(metadataClassName, 'metadata domain class', operationId);
    assertDerivedIdentifier(factoryName, 'domain factory', operationId);
    rejectDerivedCollision(
      files,
      fileName.toLowerCase(),
      operationId,
      `Case-insensitive domain path collision ${fileName}`,
    );
    rejectDerivedCollision(
      classes,
      className,
      operationId,
      `Facade domain class collision ${className}`,
    );
    rejectDerivedCollision(
      classes,
      metadataClassName,
      operationId,
      `Facade domain class collision ${metadataClassName}`,
    );
    rejectDerivedCollision(
      factories,
      factoryName,
      operationId,
      `Facade domain factory collision ${factoryName}`,
    );
  }
}

function operationHasOptions(operation: NormalizedOperation): boolean {
  return (
    operation.requestBody !== null ||
    operation.parameters.some((parameter) => parameter.placement !== 'path')
  );
}

function assertDerivedIdentifier(identifier: string, kind: string, operationId: string): void {
  if (!facadeMemberPattern.test(identifier) || reservedIdentifiers.has(identifier)) {
    throw new Error(`Invalid derived facade ${kind} for ${operationId}: ${identifier}`);
  }
}

function rejectDerivedCollision(
  symbols: Map<string, string>,
  symbol: string,
  operationId: string,
  context: string,
): void {
  const previousOperationId = symbols.get(symbol);
  if (previousOperationId !== undefined) {
    throw new Error(`${context}: ${previousOperationId} and ${operationId}`);
  }
  symbols.set(symbol, operationId);
}

function safeDefaultIdentifier(identifier: string, prefix: string): string {
  let value = identifier;
  if (!/^[A-Za-z]/u.test(value)) value = `${prefix}${capitalize(value)}`;
  if (reservedIdentifiers.has(value)) value = `${prefix}${capitalize(value)}`;
  return value;
}

function toIdentifier(value: string, fallback: string): string {
  const words = splitWords(value);
  if (words.length === 0) return fallback;
  return `${words[0].toLowerCase()}${words
    .slice(1)
    .map((word) => capitalize(word.toLowerCase()))
    .join('')}`;
}

function compareOperationIds(
  left: { readonly operationId: string },
  right: { readonly operationId: string },
): number {
  if (left.operationId < right.operationId) return -1;
  if (left.operationId > right.operationId) return 1;
  return 0;
}

function requiredString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${context} must be a non-empty trimmed string`);
  }
  return value;
}
