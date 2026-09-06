import {
  ESI_ERROR_BODY_LIMITS,
  MAX_ISSUE_STRING_CHARACTERS,
  REDACTED,
  TRUNCATED,
} from './limits.js';
import type { Redactor } from './redaction.js';
import { isSensitiveName, sanitizeString, takeBoundedText } from './redaction.js';
import type { EsiErrorBodyFormat, EsiErrorBodyValue } from './types.js';

interface NormalizationState {
  keys: number;
  arrayItems: number;
  truncated: boolean;
}

export interface NormalizedBody {
  readonly format: Exclude<EsiErrorBodyFormat, 'none'>;
  readonly value: EsiErrorBodyValue;
  readonly truncated: boolean;
}

export function normalizeErrorBody(
  bodyText: string | undefined,
  redactor: Redactor,
): NormalizedBody | undefined {
  if (typeof bodyText !== 'string') return undefined;
  const bounded = takeBoundedText(
    bodyText,
    ESI_ERROR_BODY_LIMITS.characters,
    ESI_ERROR_BODY_LIMITS.bytes,
  );
  if (!bounded.truncated) {
    try {
      const parsed: unknown = JSON.parse(bounded.text);
      const state: NormalizationState = { keys: 0, arrayItems: 0, truncated: false };
      const value = normalizeJsonValue(parsed, 0, state, redactor);
      return Object.freeze({ format: 'json', value, truncated: state.truncated });
    } catch {
      // Invalid JSON is represented as bounded text below.
    }
  }
  const text = sanitizeString(bounded.text, redactor, ESI_ERROR_BODY_LIMITS.characters, '');
  return Object.freeze({ format: 'text', value: text, truncated: bounded.truncated });
}

function normalizeJsonValue(
  value: unknown,
  depth: number,
  state: NormalizationState,
  redactor: Redactor,
): EsiErrorBodyValue {
  if (depth > ESI_ERROR_BODY_LIMITS.depth) {
    state.truncated = true;
    return TRUNCATED;
  }
  switch (typeof value) {
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : 0;
    case 'string':
      return sanitizeString(value, redactor, ESI_ERROR_BODY_LIMITS.stringCharacters, '');
    case 'object':
      return normalizeJsonObject(value, depth, state, redactor);
    default:
      state.truncated = true;
      return TRUNCATED;
  }
}

function normalizeJsonObject(
  value: object | null,
  depth: number,
  state: NormalizationState,
  redactor: Redactor,
): EsiErrorBodyValue {
  if (value === null) return null;
  if (Array.isArray(value)) return normalizeJsonArray(value, depth, state, redactor);
  const result: Record<string, EsiErrorBodyValue> = {};
  for (const [rawKey, item] of Object.entries(value)) {
    if (state.keys >= ESI_ERROR_BODY_LIMITS.keys) {
      state.truncated = true;
      break;
    }
    state.keys += 1;
    const key = sanitizeString(rawKey, redactor, MAX_ISSUE_STRING_CHARACTERS, '');
    if (Object.hasOwn(result, key)) {
      state.truncated = true;
      continue;
    }
    const normalized = isSensitiveName(rawKey)
      ? REDACTED
      : normalizeJsonValue(item, depth + 1, state, redactor);
    Object.defineProperty(result, key, {
      value: normalized,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function normalizeJsonArray(
  value: readonly unknown[],
  depth: number,
  state: NormalizationState,
  redactor: Redactor,
): EsiErrorBodyValue {
  const result: EsiErrorBodyValue[] = [];
  for (const item of value) {
    if (state.arrayItems >= ESI_ERROR_BODY_LIMITS.arrayItems) {
      state.truncated = true;
      break;
    }
    state.arrayItems += 1;
    result.push(normalizeJsonValue(item, depth + 1, state, redactor));
  }
  return Object.freeze(result);
}
