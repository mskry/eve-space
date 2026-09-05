import { createProvenanceHeader, type ArtifactProvenance } from './artifacts.ts';
import type { NormalizedOpenApiModel, NormalizedOperation, NormalizedSchema } from './normalize.ts';
import {
  defaultDomainName,
  defaultMethodName,
  type FacadeCatalogEntry,
} from './operation-metadata.ts';
import { operationSchemaName } from './zod-schema.ts';

export type NamingResponseShape = 'collection' | 'detail' | 'none';

export interface NamingReviewEntry {
  readonly operationId: string;
  readonly domain: string;
  readonly method: string;
  readonly path: string;
  readonly positionalIdentifiers: readonly string[];
  readonly summary: string | null;
  readonly responseShape: NamingResponseShape;
  readonly currentTransliteration: string;
  readonly candidateMethod: string;
  readonly candidateCollisionOperationIds: readonly string[];
  readonly acceptedDomain: string;
  readonly acceptedMethod: string;
  readonly derivedOptionsType: string | null;
  readonly note: string | null;
}

export interface NamingReviewDomain {
  readonly domain: string;
  readonly operations: readonly NamingReviewEntry[];
}

export interface NamingReview {
  readonly domains: readonly NamingReviewDomain[];
  readonly operationCount: number;
}

type NamingReviewEntryDraft = Omit<NamingReviewEntry, 'candidateCollisionOperationIds'>;

export const namingReviewReportPath = 'docs/generated/facade-naming-review.md' as const;

const semanticVerbs = new Map([
  ['accept', 'accept'],
  ['add', 'add'],
  ['calculate', 'calculate'],
  ['create', 'create'],
  ['delete', 'delete'],
  ['enqueue', 'enqueue'],
  ['fit', 'fit'],
  ['get', 'get'],
  ['invite', 'invite'],
  ['kick', 'remove'],
  ['list', 'list'],
  ['move', 'move'],
  ['open', 'open'],
  ['remove', 'remove'],
  ['search', 'search'],
  ['send', 'send'],
  ['set', 'set'],
  ['transfer', 'transfer'],
  ['update', 'update'],
]);
const terminology = new Map([
  ['corporationhistory', ['corporation', 'history']],
  ['marketdetails', ['market', 'details']],
  ['membertracking', ['member', 'tracking']],
  ['newmail', ['new', 'mail']],
  ['openwindow', ['open', 'window']],
  ['skillqueue', ['skill', 'queue']],
  ['skinr', ['skinr']],
]);
const domainRouteAliases = new Map([
  ['factionWarfare', new Set(['fw'])],
  ['planetaryInteraction', new Set(['pi'])],
  ['userInterface', new Set(['ui'])],
]);

export function createNamingReview(
  model: NormalizedOpenApiModel,
  facadeCatalog: readonly FacadeCatalogEntry[],
): NamingReview {
  validateInputs(model, facadeCatalog);
  const catalogById = new Map(facadeCatalog.map((entry) => [entry.operationId, entry]));
  const modelsByPointer = new Map(model.models.map((entry) => [entry.pointer, entry.schema]));
  const entries: NamingReviewEntryDraft[] = model.operations.map((operation) => {
    const accepted = catalogById.get(operation.operationId);
    if (accepted === undefined) {
      throw new Error(`Naming review catalog is missing operation: ${operation.operationId}`);
    }
    const positionalIdentifiers = positionalPathIdentifiers(operation);
    const responseShape = classifyResponseShape(operation, modelsByPointer);
    const candidateMethod = candidateMethodName(
      operation,
      accepted.domain,
      positionalIdentifiers,
      responseShape,
    );
    return {
      acceptedDomain: accepted.domain,
      acceptedMethod: accepted.method,
      candidateMethod,
      currentTransliteration: `${defaultDomainName(operation)}.${defaultMethodName(operation.operationId)}`,
      derivedOptionsType: operationHasOptions(operation)
        ? `${operationSchemaName(operation.operationId)}Options`
        : null,
      domain: accepted.domain,
      method: operation.method,
      note: accepted.note ?? null,
      operationId: operation.operationId,
      path: operation.path,
      positionalIdentifiers,
      responseShape,
      summary: operation.summary,
    };
  });

  const collisionsByCandidate = new Map<string, string[]>();
  for (const entry of entries) {
    const candidate = `${entry.domain}.${entry.candidateMethod}`;
    const operationIds = collisionsByCandidate.get(candidate) ?? [];
    operationIds.push(entry.operationId);
    collisionsByCandidate.set(candidate, operationIds);
  }

  const groupsByDomain = new Map<string, NamingReviewEntry[]>();
  for (const entry of entries) {
    const candidate = `${entry.domain}.${entry.candidateMethod}`;
    const collision = collisionsByCandidate.get(candidate) ?? [];
    const reviewedEntry: NamingReviewEntry = {
      ...entry,
      candidateCollisionOperationIds:
        collision.length > 1 ? collision.toSorted(compareText) : Object.freeze([]),
    };
    const domainEntries = groupsByDomain.get(entry.domain) ?? [];
    domainEntries.push(reviewedEntry);
    groupsByDomain.set(entry.domain, domainEntries);
  }

  const domains = [...groupsByDomain]
    .toSorted(([left], [right]) => compareText(left, right))
    .map(([domain, domainEntries]) => ({
      domain,
      operations: domainEntries.toSorted((left, right) =>
        compareText(left.operationId, right.operationId),
      ),
    }));
  return deepFreeze({ domains, operationCount: entries.length });
}

export function renderNamingReviewReport(
  model: NormalizedOpenApiModel,
  facadeCatalog: readonly FacadeCatalogEntry[],
  provenance: ArtifactProvenance,
): string {
  const review = createNamingReview(model, facadeCatalog);
  const sections = review.domains.map(({ domain, operations }) => {
    const rows = operations.map((operation) => {
      const collision =
        operation.candidateCollisionOperationIds.length === 0
          ? '-'
          : operation.candidateCollisionOperationIds.map(code).join('<br>');
      const route = code(`${operation.method} ${operation.path}`);
      const positionalIdentifiers =
        operation.positionalIdentifiers.length === 0
          ? '-'
          : operation.positionalIdentifiers.map(code).join(', ');
      const candidateName = code(`${operation.domain}.${operation.candidateMethod}`);
      const acceptedName = code(`${operation.acceptedDomain}.${operation.acceptedMethod}`);
      const optionsType =
        operation.derivedOptionsType === null ? '-' : code(operation.derivedOptionsType);
      return `| ${code(operation.operationId)} | ${route} | ${cell(positionalIdentifiers)} | ${cell(operation.summary ?? '-')} | ${code(operation.currentTransliteration)} | ${candidateName} | ${collision} | ${acceptedName} | ${optionsType} | ${cell(operation.note ?? '-')} |`;
    });
    return `## ${domain}\n\n| Stable ID | HTTP route | Positional identifiers | Summary | Current transliteration | Candidate name | Candidate collisions | Accepted name | Derived options type | Note |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}`;
  });
  const body = `# Facade naming review\n\nThis advisory report covers ${review.operationCount} normalized operations. Candidate names are deterministic review aids derived from each operation's domain, HTTP route, positional path identifiers, response shape, and summary. Only the maintained facade catalog is authoritative.\n\n${sections.join('\n\n')}`;
  return `${createProvenanceHeader(provenance, 'markdown')}\n${body}\n`;
}

function candidateMethodName(
  operation: NormalizedOperation,
  domain: string,
  positionalIdentifiers: readonly string[],
  responseShape: NamingResponseShape,
): string {
  const summaryWords = normalizedWords(operation.summary ?? '');
  const summaryVerb = semanticVerbs.get(summaryWords[0]);
  const verb = candidateVerb(operation.method, responseShape, summaryVerb);
  const routeResource = routeResourceWords(operation.path, domain, positionalIdentifiers, verb);
  let summaryResource = summaryWords
    .filter(
      (word, index) =>
        !(index === 0 && semanticVerbs.has(word)) &&
        word !== 'window' &&
        word !== 's' &&
        word !== 'the',
    )
    .map((word) => (word === 'information' ? 'info' : word));
  const domainWords = normalizedWords(domain);
  if (domainWords.every((word, index) => summaryResource[index] === word)) {
    summaryResource = summaryResource.slice(domainWords.length);
  }
  const resource = routeResource.length > 0 ? routeResource : summaryResource;
  const distinctResource = resource.length > 0 ? resource : ['state'];
  return `${verb}${distinctResource.map(capitalize).join('')}`;
}

function candidateVerb(
  method: string,
  responseShape: NamingResponseShape,
  summaryVerb: string | undefined,
): string {
  if (summaryVerb === 'get' || summaryVerb === 'list') {
    return responseShape === 'collection' ? 'list' : 'get';
  }
  if (method === 'GET') return responseShape === 'collection' ? 'list' : 'get';
  if (summaryVerb !== undefined) return summaryVerb;
  if (method === 'DELETE') return 'delete';
  if (method === 'PUT' || method === 'PATCH') return 'update';
  if (method === 'POST') return 'create';
  return method.toLowerCase();
}

function routeResourceWords(
  path: string,
  domain: string,
  positionalIdentifiers: readonly string[],
  verb: string,
): string[] {
  const positional = new Set(positionalIdentifiers);
  const segments = path.split('/').filter(Boolean);
  const ignoredIndexes = new Set<number>();
  for (let index = 0; index < segments.length; index += 1) {
    const match = /^\{([^{}]+)\}$/u.exec(segments[index] ?? '');
    if (match?.[1] === undefined || !positional.has(match[1])) continue;
    ignoredIndexes.add(index);
    if (index > 0) ignoredIndexes.add(index - 1);
  }
  const domainPhrase = normalizedWords(domain).join(' ');
  return segments.flatMap((segment, index) => {
    if (ignoredIndexes.has(index) || /^\{[^{}]+\}$/u.test(segment)) return [];
    const words = normalizedWords(segment);
    if (
      words.join(' ') === domainPhrase ||
      domainRouteAliases.get(domain)?.has(words.join(' ')) === true
    ) {
      return [];
    }
    return words.filter((word) => word !== verb && word !== 'window');
  });
}

function positionalPathIdentifiers(operation: NormalizedOperation): string[] {
  const pathParameters = new Set(
    operation.parameters
      .filter((parameter) => parameter.placement === 'path')
      .map((parameter) => parameter.name),
  );
  const identifiers = [...operation.path.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]);
  for (const identifier of identifiers) {
    if (!pathParameters.has(identifier)) {
      throw new Error(
        `Naming review route parameter is missing metadata: ${operation.operationId}:${identifier}`,
      );
    }
    pathParameters.delete(identifier);
  }
  if (pathParameters.size > 0) {
    throw new Error(
      `Naming review has unused path parameters for ${operation.operationId}: ${[...pathParameters].toSorted(compareText).join(', ')}`,
    );
  }
  return identifiers;
}

function classifyResponseShape(
  operation: NormalizedOperation,
  modelsByPointer: Map<string, NormalizedSchema>,
): NamingResponseShape {
  const schemas = operation.successResponses.flatMap((response) =>
    response.content.map(({ schema }) => resolveSchema(schema, modelsByPointer, new Set())),
  );
  if (schemas.length === 0) return 'none';
  if (schemas.some((schema) => schema !== true && schema !== false && schema.type === 'array')) {
    return 'collection';
  }
  return 'detail';
}

function resolveSchema(
  schema: NormalizedSchema,
  modelsByPointer: Map<string, NormalizedSchema>,
  active: Set<string>,
): NormalizedSchema {
  if (schema === true || schema === false || schema === null || typeof schema !== 'object') {
    return schema;
  }
  if (typeof schema.$ref !== 'string') return schema;
  if (active.has(schema.$ref)) return schema;
  const target = modelsByPointer.get(schema.$ref);
  if (target === undefined) return schema;
  return resolveSchema(target, modelsByPointer, new Set([...active, schema.$ref]));
}

function normalizedWords(value: string): string[] {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll(/([A-Z])(?=[A-Z][a-z])/gu, '$1 ')
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .flatMap((word) => terminology.get(word.toLowerCase()) ?? [word.toLowerCase()]);
}

function operationHasOptions(operation: NormalizedOperation): boolean {
  return (
    operation.requestBody !== null ||
    operation.parameters.some((parameter) => parameter.placement !== 'path')
  );
}

function validateInputs(
  model: NormalizedOpenApiModel,
  facadeCatalog: readonly FacadeCatalogEntry[],
): void {
  if (model === null || typeof model !== 'object' || !Array.isArray(model.operations)) {
    throw new TypeError('Naming review model must contain operations');
  }
  if (!Array.isArray(model.models) || !Array.isArray(facadeCatalog)) {
    throw new TypeError('Naming review requires normalized models and a facade catalog');
  }
  const operationIds = new Set(model.operations.map(({ operationId }) => operationId));
  const catalogIds = new Set(facadeCatalog.map(({ operationId }) => operationId));
  if (catalogIds.size !== facadeCatalog.length || operationIds.size !== catalogIds.size) {
    throw new Error('Naming review requires exact unique facade catalog coverage');
  }
  for (const operationId of operationIds) {
    if (!catalogIds.has(operationId)) {
      throw new Error(`Naming review catalog is missing operation: ${operationId}`);
    }
  }
}

function code(value: string): string {
  return `\`${value.replaceAll('`', '\\`')}\``;
}

function cell(value: string): string {
  return value.replaceAll('|', String.raw`\|`).replaceAll(/\r?\n/gu, ' ');
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}
