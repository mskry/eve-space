import {
  MAX_HEADER_COUNT,
  MAX_HEADER_NAME_CHARACTERS,
  MAX_METADATA_STRING_CHARACTERS,
  REDACTED,
} from './error/limits.js';
import { isSensitiveName, takeBoundedText } from './error/redaction.js';

export interface EsiPaginationMetadata {
  readonly pages?: number;
  readonly cursor?: string;
  readonly nextCursor?: string;
  readonly previousCursor?: string;
}

export interface EsiCacheMetadata {
  readonly etag?: string;
  readonly expires?: string;
  readonly lastModified?: string;
  readonly cacheControl?: string;
  readonly maxAgeSeconds?: number;
}

export interface EsiErrorLimitMetadata {
  readonly remaining?: number;
  readonly reset?: number;
}

export interface EsiRouteRateLimitMetadata {
  readonly group?: string;
  readonly limit?: number;
  readonly used?: number;
  readonly remaining?: number;
}

export interface EsiResponseMetadataInput {
  readonly headers?: Readonly<Record<string, string>>;
  readonly requestId?: string;
  readonly pagination?: EsiPaginationMetadata;
  readonly cache?: EsiCacheMetadata;
  readonly errorLimit?: EsiErrorLimitMetadata;
  readonly retryAfterSeconds?: number;
  readonly routeRateLimit?: EsiRouteRateLimitMetadata;
}

export interface EsiResponseMetadata {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly requestId?: string;
  readonly pagination?: EsiPaginationMetadata;
  readonly cache?: EsiCacheMetadata;
  readonly errorLimit?: EsiErrorLimitMetadata;
  readonly retryAfterSeconds?: number;
  readonly routeRateLimit?: EsiRouteRateLimitMetadata;
}

export interface EsiResponse<T> {
  readonly data: T;
  readonly meta: EsiResponseMetadata;
}

const nonnegativeIntegerPattern: RegExp = /^(?:0|[1-9]\d*)$/u;
const finiteNumberPattern: RegExp = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu;

export function extractEsiResponseMetadata(status: number, headers: Headers): EsiResponseMetadata {
  if (!Number.isInteger(status) || status < 0 || status > 999) {
    throw new TypeError('Response status must be an integer between 0 and 999');
  }

  const headerRecord = headersToRecord(headers);
  const metadata: {
    status: number;
    headers: Readonly<Record<string, string>>;
    requestId?: string;
    pagination?: EsiPaginationMetadata;
    cache?: EsiCacheMetadata;
    errorLimit?: EsiErrorLimitMetadata;
    retryAfterSeconds?: number;
    routeRateLimit?: EsiRouteRateLimitMetadata;
  } = { status, headers: headerRecord };

  const requestId = firstPresentHeader(headerRecord, ['x-esi-request-id', 'x-request-id']);
  if (requestId !== undefined) metadata.requestId = requestId;

  const pagination = extractPagination(headerRecord);
  if (pagination !== undefined) metadata.pagination = pagination;

  const cache = extractCache(headerRecord);
  if (cache !== undefined) metadata.cache = cache;

  const errorLimit = extractErrorLimit(headerRecord);
  if (errorLimit !== undefined) metadata.errorLimit = errorLimit;
  const retryAfterSeconds = parseNonnegativeInteger(headerRecord['retry-after']);
  if (retryAfterSeconds !== undefined) metadata.retryAfterSeconds = retryAfterSeconds;
  const routeRateLimit = extractRouteRateLimit(headerRecord);
  if (routeRateLimit !== undefined) metadata.routeRateLimit = routeRateLimit;

  return Object.freeze(metadata);
}

export function createEsiResponse<T>(data: T, meta: EsiResponseMetadata): EsiResponse<T> {
  return Object.freeze({ data, meta: freezeMetadata(meta) });
}

function freezeMetadata(input: EsiResponseMetadata): EsiResponseMetadata {
  const metadata: {
    status: number;
    headers: Readonly<Record<string, string>>;
    requestId?: string;
    pagination?: EsiPaginationMetadata;
    cache?: EsiCacheMetadata;
    errorLimit?: EsiErrorLimitMetadata;
    retryAfterSeconds?: number;
    routeRateLimit?: EsiRouteRateLimitMetadata;
  } = {
    status: input.status,
    headers: freezeRecord(input.headers),
  };
  if (input.requestId !== undefined) metadata.requestId = input.requestId;
  if (input.pagination !== undefined) metadata.pagination = Object.freeze({ ...input.pagination });
  if (input.cache !== undefined) metadata.cache = Object.freeze({ ...input.cache });
  if (input.errorLimit !== undefined) metadata.errorLimit = Object.freeze({ ...input.errorLimit });
  if (input.retryAfterSeconds !== undefined) metadata.retryAfterSeconds = input.retryAfterSeconds;
  if (input.routeRateLimit !== undefined)
    metadata.routeRateLimit = Object.freeze({ ...input.routeRateLimit });
  return Object.freeze(metadata);
}

function freezeRecord(input: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    Object.defineProperty(result, name, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function headersToRecord(headers: Headers): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  let count = 0;
  headers.forEach((value, rawName) => {
    if (count >= MAX_HEADER_COUNT) return;
    const name = takeBoundedText(rawName.toLowerCase(), MAX_HEADER_NAME_CHARACTERS, Infinity).text;
    if (name.length === 0 || Object.hasOwn(result, name)) return;
    const boundedValue = isSensitiveName(name)
      ? REDACTED
      : takeBoundedText(value, MAX_METADATA_STRING_CHARACTERS, Infinity).text;
    Object.defineProperty(result, name, {
      value: boundedValue,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    count += 1;
  });
  return Object.freeze(result);
}

function extractPagination(
  headers: Readonly<Record<string, string>>,
): EsiPaginationMetadata | undefined {
  const pagination: {
    pages?: number;
    cursor?: string;
    nextCursor?: string;
    previousCursor?: string;
  } = {};
  const pages = parseNonnegativeInteger(headers['x-pages']);
  if (pages !== undefined) pagination.pages = pages;
  const cursor = nonemptyHeader(headers['x-cursor']);
  if (cursor !== undefined) pagination.cursor = cursor;
  const nextCursor = nonemptyHeader(headers['x-next-cursor']);
  if (nextCursor !== undefined) pagination.nextCursor = nextCursor;
  const previousCursor = nonemptyHeader(headers['x-previous-cursor']);
  if (previousCursor !== undefined) pagination.previousCursor = previousCursor;
  return Object.keys(pagination).length === 0 ? undefined : Object.freeze(pagination);
}

function extractCache(headers: Readonly<Record<string, string>>): EsiCacheMetadata | undefined {
  const cache: {
    etag?: string;
    expires?: string;
    lastModified?: string;
    cacheControl?: string;
    maxAgeSeconds?: number;
  } = {};
  const etag = nonemptyHeader(headers.etag);
  if (etag !== undefined) cache.etag = etag;
  const expires = nonemptyHeader(headers.expires);
  if (expires !== undefined) cache.expires = expires;
  const lastModified = nonemptyHeader(headers['last-modified']);
  if (lastModified !== undefined) cache.lastModified = lastModified;
  const cacheControl = nonemptyHeader(headers['cache-control']);
  if (cacheControl !== undefined) {
    cache.cacheControl = cacheControl;
    const maxAgeSeconds = parseCacheControlMaxAge(cacheControl);
    if (maxAgeSeconds !== undefined) cache.maxAgeSeconds = maxAgeSeconds;
  }
  return Object.keys(cache).length === 0 ? undefined : Object.freeze(cache);
}

function extractRouteRateLimit(
  headers: Readonly<Record<string, string>>,
): EsiRouteRateLimitMetadata | undefined {
  const rateLimit: {
    group?: string;
    limit?: number;
    used?: number;
    remaining?: number;
  } = {};
  const group = nonemptyHeader(headers['x-ratelimit-group']);
  if (group !== undefined) rateLimit.group = group;
  const limit = parseNonnegativeInteger(headers['x-ratelimit-limit']);
  if (limit !== undefined) rateLimit.limit = limit;
  const used = parseNonnegativeInteger(headers['x-ratelimit-used']);
  if (used !== undefined) rateLimit.used = used;
  const remaining = parseNonnegativeInteger(headers['x-ratelimit-remaining']);
  if (remaining !== undefined) rateLimit.remaining = remaining;
  return Object.keys(rateLimit).length === 0 ? undefined : Object.freeze(rateLimit);
}

function parseCacheControlMaxAge(value: string): number | undefined {
  let maxAge: number | undefined;
  for (const rawDirective of value.split(',')) {
    const directive = rawDirective.trim();
    const separator = directive.indexOf('=');
    if (separator < 0 || directive.slice(0, separator).trim().toLowerCase() !== 'max-age') continue;
    if (maxAge !== undefined) return undefined;
    const parsed = parseNonnegativeInteger(directive.slice(separator + 1).trim());
    if (parsed === undefined) return undefined;
    maxAge = parsed;
  }
  return maxAge;
}

function extractErrorLimit(
  headers: Readonly<Record<string, string>>,
): EsiErrorLimitMetadata | undefined {
  const errorLimit: { remaining?: number; reset?: number } = {};
  const remaining = parseNonnegativeFiniteNumber(headers['x-esi-error-limit-remain']);
  if (remaining !== undefined) errorLimit.remaining = remaining;
  const reset = parseNonnegativeFiniteNumber(headers['x-esi-error-limit-reset']);
  if (reset !== undefined) errorLimit.reset = reset;
  return Object.keys(errorLimit).length === 0 ? undefined : Object.freeze(errorLimit);
}

function firstPresentHeader(
  headers: Readonly<Record<string, string>>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = nonemptyHeader(headers[name]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function nonemptyHeader(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined || !finiteNumberPattern.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNonnegativeFiniteNumber(value: string | undefined): number | undefined {
  const parsed = parseFiniteNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function parseNonnegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || !nonnegativeIntegerPattern.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
