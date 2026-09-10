import type {
  EsiCacheMetadata,
  EsiErrorLimitMetadata,
  EsiPaginationMetadata,
  EsiResponseMetadata,
  EsiResponseMetadataInput,
  EsiRouteRateLimitMetadata,
} from '../response.js';
import {
  MAX_HEADER_COUNT,
  MAX_HEADER_NAME_CHARACTERS,
  MAX_ISSUE_PATH_SEGMENTS,
  MAX_ISSUE_STRING_CHARACTERS,
  MAX_ISSUES,
  MAX_METADATA_STRING_CHARACTERS,
  MAX_SCOPES,
  REDACTED,
} from './limits.js';
import type { Redactor } from './redaction.js';
import { isSensitiveName, sanitizeString } from './redaction.js';
import type { EsiValidationIssue, EsiValidationIssueInput } from './types.js';

export function normalizeStatus(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 999 ? value : 0;
}

export function normalizeMetadata(
  status: number,
  input: EsiResponseMetadataInput | undefined,
  redactor: Redactor,
): EsiResponseMetadata {
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
    status,
    headers: normalizeHeaders(input?.headers, redactor),
  };
  if (input?.requestId !== undefined) {
    metadata.requestId = sanitizeString(
      input.requestId,
      redactor,
      MAX_METADATA_STRING_CHARACTERS,
      '',
    );
  }
  const pagination = normalizePagination(input?.pagination, redactor);
  if (pagination !== undefined) metadata.pagination = pagination;
  const cache = normalizeCache(input?.cache, redactor);
  if (cache !== undefined) metadata.cache = cache;
  const errorLimit = normalizeErrorLimit(input?.errorLimit);
  if (errorLimit !== undefined) metadata.errorLimit = errorLimit;
  if (isNonnegativeFiniteNumber(input?.retryAfterSeconds))
    metadata.retryAfterSeconds = input.retryAfterSeconds;
  const routeRateLimit = normalizeRouteRateLimit(input?.routeRateLimit, redactor);
  if (routeRateLimit !== undefined) metadata.routeRateLimit = routeRateLimit;
  return Object.freeze(metadata);
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  redactor: Redactor,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  let count = 0;
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    if (count >= MAX_HEADER_COUNT) break;
    if (typeof rawValue !== 'string') continue;
    const name = sanitizeString(rawName.toLowerCase(), redactor, MAX_HEADER_NAME_CHARACTERS, '');
    if (name.length === 0) continue;
    if (Object.hasOwn(result, name)) continue;
    const value = isSensitiveName(rawName)
      ? REDACTED
      : sanitizeString(rawValue, redactor, MAX_METADATA_STRING_CHARACTERS, '');
    Object.defineProperty(result, name, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    count += 1;
  }
  return Object.freeze(result);
}

function normalizePagination(
  input: EsiPaginationMetadata | undefined,
  redactor: Redactor,
): EsiPaginationMetadata | undefined {
  if (input === undefined) return undefined;
  const result: {
    pages?: number;
    cursor?: string;
    nextCursor?: string;
    previousCursor?: string;
  } = {};
  if (isFiniteNumber(input.pages)) result.pages = input.pages;
  if (input.cursor !== undefined) {
    result.cursor = sanitizeString(input.cursor, redactor, MAX_METADATA_STRING_CHARACTERS, '');
  }
  if (input.nextCursor !== undefined) {
    result.nextCursor = sanitizeString(
      input.nextCursor,
      redactor,
      MAX_METADATA_STRING_CHARACTERS,
      '',
    );
  }
  if (input.previousCursor !== undefined) {
    result.previousCursor = sanitizeString(
      input.previousCursor,
      redactor,
      MAX_METADATA_STRING_CHARACTERS,
      '',
    );
  }
  return Object.freeze(result);
}

function normalizeCache(
  input: EsiCacheMetadata | undefined,
  redactor: Redactor,
): EsiCacheMetadata | undefined {
  if (input === undefined) return undefined;
  const result: {
    etag?: string;
    expires?: string;
    lastModified?: string;
    cacheControl?: string;
    maxAgeSeconds?: number;
  } = {};
  if (input.etag !== undefined) {
    result.etag = sanitizeString(input.etag, redactor, MAX_METADATA_STRING_CHARACTERS, '');
  }
  if (input.expires !== undefined) {
    result.expires = sanitizeString(input.expires, redactor, MAX_METADATA_STRING_CHARACTERS, '');
  }
  if (input.lastModified !== undefined) {
    result.lastModified = sanitizeString(
      input.lastModified,
      redactor,
      MAX_METADATA_STRING_CHARACTERS,
      '',
    );
  }
  if (input.cacheControl !== undefined) {
    result.cacheControl = sanitizeString(
      input.cacheControl,
      redactor,
      MAX_METADATA_STRING_CHARACTERS,
      '',
    );
  }
  if (isNonnegativeFiniteNumber(input.maxAgeSeconds)) result.maxAgeSeconds = input.maxAgeSeconds;
  return Object.freeze(result);
}

function normalizeErrorLimit(
  input: EsiErrorLimitMetadata | undefined,
): EsiErrorLimitMetadata | undefined {
  if (input === undefined) return undefined;
  const result: { remaining?: number; reset?: number } = {};
  if (isNonnegativeFiniteNumber(input.remaining)) result.remaining = input.remaining;
  if (isNonnegativeFiniteNumber(input.reset)) result.reset = input.reset;
  return Object.freeze(result);
}

function normalizeRouteRateLimit(
  input: EsiRouteRateLimitMetadata | undefined,
  redactor: Redactor,
): EsiRouteRateLimitMetadata | undefined {
  if (input === undefined) return undefined;
  const result: {
    group?: string;
    limit?: number;
    used?: number;
    remaining?: number;
  } = {};
  if (input.group !== undefined)
    result.group = sanitizeString(input.group, redactor, MAX_METADATA_STRING_CHARACTERS, '');
  if (isNonnegativeFiniteNumber(input.limit)) result.limit = input.limit;
  if (isNonnegativeFiniteNumber(input.used)) result.used = input.used;
  if (isNonnegativeFiniteNumber(input.remaining)) result.remaining = input.remaining;
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonnegativeFiniteNumber(value: number | undefined): value is number {
  return isFiniteNumber(value) && value >= 0;
}

export function normalizeScopes(
  scopes: readonly string[] | undefined,
  redactor: Redactor,
): readonly string[] {
  const normalized: string[] = [];
  for (const scope of scopes ?? []) {
    if (normalized.length >= MAX_SCOPES) break;
    if (typeof scope !== 'string') continue;
    normalized.push(sanitizeString(scope, redactor, MAX_ISSUE_STRING_CHARACTERS, ''));
  }
  return Object.freeze(normalized);
}

export function normalizeIssues(
  issues: readonly EsiValidationIssueInput[],
  redactor: Redactor,
): readonly EsiValidationIssue[] {
  const normalized: EsiValidationIssue[] = [];
  for (const issue of issues) {
    if (normalized.length >= MAX_ISSUES) break;
    if (typeof issue !== 'object' || issue === null) continue;
    normalized.push(
      Object.freeze({
        path: normalizeIssuePath(issue.path, redactor),
        message: sanitizeString(
          issue.message,
          redactor,
          MAX_ISSUE_STRING_CHARACTERS,
          'Validation failed',
        ),
        code: sanitizeString(issue.code, redactor, MAX_ISSUE_STRING_CHARACTERS, 'custom'),
      }),
    );
  }
  return Object.freeze(normalized);
}

function normalizeIssuePath(
  input: readonly PropertyKey[] | undefined,
  redactor: Redactor,
): readonly (string | number)[] {
  const path: (string | number)[] = [];
  for (const segment of input ?? []) {
    if (path.length >= MAX_ISSUE_PATH_SEGMENTS) break;
    if (typeof segment === 'number' && Number.isFinite(segment)) path.push(segment);
    if (typeof segment === 'string') {
      path.push(sanitizeString(segment, redactor, MAX_ISSUE_STRING_CHARACTERS, ''));
    }
  }
  return Object.freeze(path);
}
