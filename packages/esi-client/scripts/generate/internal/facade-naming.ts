import { capitalize } from './text.ts';

/**
 * Single source of truth for every identifier the generator derives from specification names.
 * The emitters, the documented method signatures, and the facade catalog validator must all
 * agree, so none of these derivations may be reimplemented at a call site.
 */

/** Reserved words that may not be used bare as a generated identifier. */
export const reservedIdentifiers: ReadonlySet<string> = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'constructor',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/** Identifiers the generator emits into source: locals, parameters, and derived type names. */
export const generatedIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/** Domain and method names declared in the facade catalog; deliberately stricter. */
export const facadeMemberPattern = /^[A-Za-z][A-Za-z0-9]*$/u;

/** Splits camelCase, PascalCase, snake_case, and kebab-case into lowercase-able words. */
export function splitWords(value: string): string[] {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll(/([A-Z])(?=[A-Z][a-z])/gu, '$1 ')
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean);
}

/** Derives the camelCase identifier a wire parameter name is exposed as on the facade. */
export function facadeParameterName(value: string): string {
  const words = splitWords(value);
  if (words.length === 0) throw new Error(`Cannot derive facade parameter name from ${value}`);
  let identifier = `${words[0].toLowerCase()}${words
    .slice(1)
    .map((word) => capitalize(word.toLowerCase()))
    .join('')}`;
  if (!/^[A-Za-z_$]/u.test(identifier)) identifier = `value${capitalize(identifier)}`;
  if (!generatedIdentifierPattern.test(identifier)) {
    throw new Error(`Invalid generated facade parameter identifier: ${identifier}`);
  }
  return identifier;
}

/**
 * Assigns positional identifiers to a path template's parameters, suffixing to avoid reserved
 * words, the trailing `options` argument, and collisions between two parameters.
 */
export function assignPathIdentifier(value: string, used: Set<string>): string {
  let identifier = facadeParameterName(value);
  if (reservedIdentifiers.has(identifier) || used.has(identifier)) {
    identifier = `${identifier}Value`;
  }
  const base = identifier;
  let suffix = 2;
  while (used.has(identifier)) {
    identifier = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(identifier);
  return identifier;
}

export function domainFileName(domain: string): string {
  return domain
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replaceAll(/([A-Z])(?=[A-Z][a-z])/gu, '$1-')
    .toLowerCase();
}

export interface DomainSymbolNames {
  readonly className: string;
  readonly metadataClassName: string;
  readonly factoryName: string;
  readonly fileName: string;
}

export function domainSymbolNames(domain: string): DomainSymbolNames {
  const className = `${capitalize(domain)}DomainClient`;
  return {
    className,
    factoryName: `create${capitalize(domain)}Client`,
    fileName: domainFileName(domain),
    metadataClassName: `${className}WithMetadata`,
  };
}
