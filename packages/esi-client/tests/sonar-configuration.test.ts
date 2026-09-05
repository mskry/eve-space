import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const packageRoot = fileURLToPath(new URL('../', import.meta.url));

describe('Sonar project boundaries', () => {
  let rootProperties: ReadonlyMap<string, string>;
  let packageProperties: ReadonlyMap<string, string>;

  beforeAll(async () => {
    rootProperties = parseProperties(
      await readFile(resolve(repositoryRoot, 'sonar-project.properties'), 'utf8'),
    );
    packageProperties = parseProperties(
      await readFile(resolve(packageRoot, 'sonar-project.properties'), 'utf8'),
    );
  });

  it.each(['sonar.sources', 'sonar.tests', 'sonar.javascript.lcov.reportPaths'])(
    'keeps %s ownership disjoint',
    (key) => {
      const rootPaths = resolvePaths(repositoryRoot, requiredProperty(rootProperties, key));
      const packagePaths = resolvePaths(packageRoot, requiredProperty(packageProperties, key));

      for (const rootPath of rootPaths) {
        for (const packagePath of packagePaths) {
          expect(pathsOverlap(rootPath, packagePath), `${rootPath} overlaps ${packagePath}`).toBe(
            false,
          );
        }
      }
    },
  );

  it('assigns all ESI client analysis paths to the package project', () => {
    for (const key of [
      'sonar.sources',
      'sonar.tests',
      'sonar.exclusions',
      'sonar.coverage.exclusions',
      'sonar.javascript.lcov.reportPaths',
    ]) {
      expect(requiredProperty(rootProperties, key)).not.toContain('packages/esi-client');
    }

    expect(csv(packageProperties, 'sonar.sources')).toEqual(['src', 'scripts']);
    expect(csv(packageProperties, 'sonar.tests')).toEqual(['tests']);
    expect(csv(packageProperties, 'sonar.javascript.lcov.reportPaths')).toEqual([
      'coverage/lcov.info',
    ]);
  });

  it('retains generated, build, dependency, declaration, and coverage exclusions', () => {
    expect(csv(rootProperties, 'sonar.exclusions')).toContain('generated/**');
    expect(csv(packageProperties, 'sonar.exclusions')).toEqual(
      expect.arrayContaining([
        '**/node_modules/**',
        '**/dist/**',
        'src/generated/**',
        'tests/generated/**',
        'scripts/**/*.d.mts',
        '**/coverage/**',
        '**/*.d.ts',
      ]),
    );
    expect(csv(packageProperties, 'sonar.coverage.exclusions')).toContain('scripts/**');
  });

  it('waits for both independent quality gates', () => {
    for (const properties of [rootProperties, packageProperties]) {
      expect(requiredProperty(properties, 'sonar.qualitygate.wait')).toBe('true');
      expect(requiredProperty(properties, 'sonar.qualitygate.timeout')).toBe('300');
    }
  });
});

function parseProperties(source: string): ReadonlyMap<string, string> {
  const properties = new Map<string, string>();
  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    const normalized = line.trim();
    if (normalized === '' || normalized.startsWith('#')) continue;
    const separator = normalized.indexOf('=');
    if (separator < 1) throw new Error(`Invalid Sonar property: ${line}`);
    const key = normalized.slice(0, separator).trim();
    if (properties.has(key)) throw new Error(`Duplicate Sonar property: ${key}`);
    properties.set(key, normalized.slice(separator + 1).trim());
  }
  return properties;
}

function requiredProperty(properties: ReadonlyMap<string, string>, key: string): string {
  const value = properties.get(key);
  if (value === undefined) throw new Error(`Missing Sonar property: ${key}`);
  return value;
}

function csv(properties: ReadonlyMap<string, string>, key: string): string[] {
  return requiredProperty(properties, key)
    .split(',')
    .map((value) => value.trim());
}

function resolvePaths(base: string, value: string): string[] {
  return value.split(',').map((path) => relative(repositoryRoot, resolve(base, path.trim())));
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}${sep}`) || right.startsWith(`${left}${sep}`);
}
