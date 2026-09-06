import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { promisify } from 'node:util';
import { gunzip as gunzipCallback } from 'node:zlib';

interface ArchiveEntry {
  readonly body: Buffer;
  readonly header: Buffer;
  readonly nextOffset: number;
  readonly type: string;
}

interface ExtractionState {
  globalPax: Record<string, string>;
  nextPax: Record<string, string>;
  nextLongPath: string | undefined;
}

const gunzip = promisify(gunzipCallback);
const blockSize = 512;

export async function extractPackageTarball(tarball: string, destination: string): Promise<string> {
  const archive = await gunzip(await readFile(tarball));
  const extracted = new Set<string>();
  const state: ExtractionState = { globalPax: {}, nextPax: {}, nextLongPath: undefined };

  await mkdir(destination, { recursive: true });

  for (let offset = 0; offset + blockSize <= archive.length;) {
    const entry = readArchiveEntry(archive, offset);
    if (entry === undefined) break;
    offset = entry.nextOffset;
    if (applyExtendedHeader(entry, state)) continue;
    await extractArchiveEntry(entry, state, extracted, destination);
  }

  if (!extracted.has('package/package.json')) {
    throw new Error('Package tarball does not contain package/package.json');
  }
  return join(destination, 'package');
}

function readArchiveEntry(archive: Buffer, offset: number): ArchiveEntry | undefined {
  const header = archive.subarray(offset, offset + blockSize);
  if (header.every((byte) => byte === 0)) return undefined;
  validateChecksum(header);

  const size = parseOctal(header.subarray(124, 136), 'entry size');
  const bodyOffset = offset + blockSize;
  const bodyEnd = bodyOffset + size;
  if (bodyEnd > archive.length) throw new Error('Truncated package tarball entry');
  return {
    body: archive.subarray(bodyOffset, bodyEnd),
    header,
    nextOffset: bodyOffset + Math.ceil(size / blockSize) * blockSize,
    type: decode(header.subarray(156, 157)),
  };
}

function applyExtendedHeader(entry: ArchiveEntry, state: ExtractionState): boolean {
  if (entry.type === 'g' || entry.type === 'x') {
    const values = parsePax(entry.body);
    if (entry.type === 'g') state.globalPax = { ...state.globalPax, ...values };
    else state.nextPax = values;
    return true;
  }
  if (entry.type === 'L') {
    state.nextLongPath = decode(entry.body);
    return true;
  }
  return false;
}

async function extractArchiveEntry(
  entry: ArchiveEntry,
  state: ExtractionState,
  extracted: Set<string>,
  destination: string,
): Promise<void> {
  const name = decode(entry.header.subarray(0, 100));
  const prefix = decode(entry.header.subarray(345, 500));
  const headerPath = prefix.length === 0 ? name : `${prefix}/${name}`;
  const archivePath =
    state.globalPax.path ?? state.nextPax.path ?? state.nextLongPath ?? headerPath;
  state.nextPax = {};
  state.nextLongPath = undefined;

  const normalizedPath = safePackagePath(archivePath);
  if (extracted.has(normalizedPath)) {
    throw new Error(`Duplicate package tarball entry: ${normalizedPath}`);
  }
  extracted.add(normalizedPath);
  const outputPath = join(destination, ...normalizedPath.split('/'));

  if (entry.type === '5') {
    await mkdir(outputPath, { recursive: true });
    return;
  }
  if (entry.type !== '' && entry.type !== '0') {
    throw new Error(`Unsupported package tarball entry type ${JSON.stringify(entry.type)}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, entry.body);
}

function safePackagePath(value: string): string {
  const normalized = posix.normalize(value);
  if (
    value.length === 0 ||
    posix.isAbsolute(value) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    (normalized !== 'package' && !normalized.startsWith('package/'))
  ) {
    throw new Error(`Unsafe package tarball path: ${value}`);
  }
  return normalized;
}

function parsePax(body: Buffer): Record<string, string> {
  const source = body.toString('utf8');
  const values: Record<string, string> = {};
  let offset = 0;
  while (offset < source.length) {
    const separator = source.indexOf(' ', offset);
    if (separator < 0) throw new Error('Invalid package tarball PAX record');
    const length = Number(source.slice(offset, separator));
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > source.length) {
      throw new Error('Invalid package tarball PAX record length');
    }
    const record = source.slice(separator + 1, offset + length - 1);
    const equals = record.indexOf('=');
    if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

function validateChecksum(header: Buffer): void {
  const expected = parseOctal(header.subarray(148, 156), 'checksum');
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) throw new Error('Invalid package tarball checksum');
}

function parseOctal(value: Buffer, label: string): number {
  const source = decode(value).trim();
  if (!/^[0-7]+$/u.test(source)) throw new Error(`Invalid package tarball ${label}`);
  const parsed = Number.parseInt(source, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid package tarball ${label}`);
  }
  return parsed;
}

function decode(value: Buffer): string {
  const zero = value.indexOf(0);
  return value
    .subarray(0, zero < 0 ? value.length : zero)
    .toString('utf8')
    .trimEnd();
}
