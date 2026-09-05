import type { EsiErrorRedactionContext } from './types.js';
import { MAX_SECRET_LOOKAHEAD, REDACTED, TRUNCATED } from './limits.js';

export interface Redactor {
  readonly secrets: readonly string[];
  readonly lookahead: number;
}

export interface BoundedText {
  readonly text: string;
  readonly truncated: boolean;
}

const sensitiveAssignmentNamePattern: string = [
  '(?:proxy-)?authorization',
  'access[_-]?token',
  'refresh[_-]?token',
  'id[_-]?token',
  'api[_-]?key',
  'password',
  'client[_-]?secret',
].join('|');
const sensitiveAssignmentValuePattern: string = String.raw`"[^"]*"|'[^']*'|[^\s,;}\]]+`;
const sensitiveAssignmentPattern: RegExp = new RegExp(
  String.raw`\b(${sensitiveAssignmentNamePattern})\b\s*[:=]\s*(?:${sensitiveAssignmentValuePattern})`,
  'giu',
);
const sensitiveNames: ReadonlySet<string> = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'password',
  'clientsecret',
]);

export function createRedactor(context: EsiErrorRedactionContext | undefined): Redactor {
  const secrets: string[] = [];
  let lookahead = 0;
  for (const secret of context?.secrets ?? []) {
    if (typeof secret !== 'string' || secret.length === 0 || secrets.includes(secret)) continue;
    secrets.push(secret);
    lookahead = Math.max(lookahead, Math.min(secret.length, MAX_SECRET_LOOKAHEAD));
  }
  return { secrets, lookahead };
}

export function sanitizeString(
  value: string | undefined,
  redactor: Redactor,
  maximumCharacters: number,
  fallback: string,
): string {
  if (typeof value !== 'string') return fallback;
  const prefix = takeBoundedText(value, maximumCharacters + redactor.lookahead, Infinity);
  const redacted = redactText(prefix.text, redactor);
  const bounded = takeBoundedText(redacted, maximumCharacters, Infinity);
  if (!bounded.truncated && !prefix.truncated) return bounded.text;
  const markedPrefix = takeBoundedText(
    redacted,
    Math.max(0, maximumCharacters - TRUNCATED.length),
    Infinity,
  );
  return `${markedPrefix.text}${TRUNCATED}`;
}

export function redactText(value: string, redactor: Redactor): string {
  let redacted = value;
  for (const secret of redactor.secrets) redacted = redacted.split(secret).join(REDACTED);
  redacted = redacted.replace(/\b(Bearer|Basic)\s+[^\s"',;}\]]+/giu, '$1 [REDACTED]');
  return redacted.replace(sensitiveAssignmentPattern, '$1=[REDACTED]');
}

export function takeBoundedText(
  value: string,
  maximumCharacters: number,
  maximumBytes: number,
): BoundedText {
  let text = '';
  let characters = 0;
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    let characterBytes = 4;
    if (codePoint <= 0x7f) characterBytes = 1;
    else if (codePoint <= 0x7ff) characterBytes = 2;
    else if (codePoint <= 0xffff) characterBytes = 3;
    if (characters >= maximumCharacters || bytes + characterBytes > maximumBytes) {
      return { text, truncated: true };
    }
    text += character;
    characters += 1;
    bytes += characterBytes;
  }
  return { text, truncated: false };
}

export function isSensitiveName(value: string): boolean {
  return sensitiveNames.has(value.toLowerCase().replaceAll('-', '').replaceAll('_', ''));
}
