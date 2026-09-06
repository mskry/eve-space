import type {
  EsiClientOptions,
  EsiFetch,
  EsiLanguage,
  EsiTokenProvider,
  SerializedEsiClientConfiguration,
} from './options.js';

export type {
  EsiClientOptions,
  EsiFetch,
  EsiLanguage,
  EsiTokenProvider,
  SerializedEsiClientConfiguration,
} from './options.js';

export const DEFAULT_ESI_BASE_URL: string = 'https://esi.evetech.net';
export const PINNED_ESI_COMPATIBILITY_DATE: string = '2026-08-18';
export const DEFAULT_ESI_LANGUAGE: EsiLanguage = 'en';

const optionNameRecord = {
  baseUrl: true,
  compatibilityDate: true,
  language: true,
  token: true,
  tokenProvider: true,
  fetch: true,
  validateResponses: true,
  validateRequests: true,
  allowGenericMutations: true,
} satisfies Record<keyof EsiClientOptions, true>;
const optionNames: ReadonlySet<string> = new Set(Object.keys(optionNameRecord));
const esiLanguages: ReadonlySet<string> = new Set(['de', 'en', 'es', 'fr', 'ja', 'ko', 'ru', 'zh']);
const compatibilityDatePattern: RegExp = /^\d{4}-\d{2}-\d{2}$/u;

export class EsiClientConfiguration {
  readonly baseUrl: string;
  readonly compatibilityDate: string;
  readonly language: EsiLanguage;
  readonly fetch: EsiFetch;
  readonly validateResponses: boolean;
  readonly validateRequests: boolean;
  readonly allowGenericMutations: boolean;

  readonly #token: string | undefined;
  readonly #tokenProvider: EsiTokenProvider | undefined;

  constructor(options: EsiClientOptions = {}) {
    assertOptions(options);
    assertMutuallyExclusiveAuthentication(options);

    this.baseUrl = normalizeBaseUrl(defaultIfUndefined(options.baseUrl, DEFAULT_ESI_BASE_URL));
    this.compatibilityDate = validateCompatibilityDate(
      defaultIfUndefined(options.compatibilityDate, PINNED_ESI_COMPATIBILITY_DATE),
    );
    this.language = validateLanguage(defaultIfUndefined(options.language, DEFAULT_ESI_LANGUAGE));
    this.#token = validateToken(options.token);
    this.#tokenProvider = validateTokenProvider(options.tokenProvider);
    this.fetch = validateFetch(defaultIfUndefined(options.fetch, globalThis.fetch));
    this.validateResponses = validateBoolean(
      'validateResponses',
      defaultIfUndefined(options.validateResponses, true),
    );
    this.validateRequests = validateBoolean(
      'validateRequests',
      defaultIfUndefined(options.validateRequests, false),
    );
    this.allowGenericMutations = validateBoolean(
      'allowGenericMutations',
      defaultIfUndefined(options.allowGenericMutations, false),
    );

    Object.freeze(this);
  }

  get token(): string | undefined {
    return this.#token;
  }

  get tokenProvider(): EsiTokenProvider | undefined {
    return this.#tokenProvider;
  }

  toJSON(): SerializedEsiClientConfiguration {
    return Object.freeze({
      baseUrl: this.baseUrl,
      compatibilityDate: this.compatibilityDate,
      language: this.language,
      validateResponses: this.validateResponses,
      validateRequests: this.validateRequests,
      allowGenericMutations: this.allowGenericMutations,
    });
  }
}

function defaultIfUndefined<Value>(value: Value | undefined, fallback: Value): Value {
  if (value === undefined) return fallback;
  return value;
}

function assertOptions(options: EsiClientOptions): void {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('ESI client options must be an object');
  }

  for (const optionName of Object.keys(options)) {
    if (!optionNames.has(optionName)) {
      throw new TypeError(`Unknown ESI client option: ${optionName}`);
    }
  }
}

function assertMutuallyExclusiveAuthentication(options: EsiClientOptions): void {
  if (options.token !== undefined && options.tokenProvider !== undefined) {
    throw new TypeError('Configure either token or tokenProvider, not both');
  }
}

function normalizeBaseUrl(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new TypeError('baseUrl must be a non-empty URL without surrounding whitespace');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('baseUrl must be a valid absolute URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('baseUrl must use the http or https protocol');
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('baseUrl must not contain credentials');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new TypeError('baseUrl must not contain a query string or fragment');
  }

  const href = url.href;
  let end = href.length;
  while (href[end - 1] === '/') end -= 1;
  return href.slice(0, end);
}

function validateCompatibilityDate(value: string): string {
  if (typeof value !== 'string' || !compatibilityDatePattern.test(value)) {
    throw new TypeError('compatibilityDate must use the YYYY-MM-DD format');
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== value) {
    throw new TypeError('compatibilityDate must be a valid calendar date');
  }
  return value;
}

function validateLanguage(value: EsiLanguage): EsiLanguage {
  if (typeof value !== 'string' || !esiLanguages.has(value)) {
    throw new TypeError('language must be one of: de, en, es, fr, ja, ko, ru, zh');
  }
  return value;
}

function validateToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || hasUnsafeTokenCharacter(value)) {
    throw new TypeError(
      'token must be a non-empty string without whitespace or control characters',
    );
  }
  return value;
}

function hasUnsafeTokenCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

function validateTokenProvider(value: EsiTokenProvider | undefined): EsiTokenProvider | undefined {
  if (value !== undefined && typeof value !== 'function') {
    throw new TypeError('tokenProvider must be a function');
  }
  return value;
}

function validateFetch(value: EsiFetch): EsiFetch {
  if (typeof value !== 'function') {
    throw new TypeError('fetch must be a function');
  }
  return value;
}

function validateBoolean(name: string, value: boolean): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`);
  }
  return value;
}
