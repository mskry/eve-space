import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classifyProjectPath,
  generatedPaths,
  generatedReplacementTargets,
  normalizeGeneratedPath,
  repositoryRoot,
  resolveGeneratedReplacementTargets,
} from '../scripts/generate/paths.ts';

describe('generation path boundaries', () => {
  it('declares a replacement boundary for every generated artifact kind', () => {
    expect(Object.keys(generatedPaths)).toEqual([
      'source',
      'documentation',
      'examples',
      'tests',
      'openapi',
    ]);
    expect(resolveGeneratedReplacementTargets()).toEqual(
      generatedReplacementTargets.map((path) => resolve(repositoryRoot, path)),
    );
  });

  it('treats only declared generated trees and files as generated', () => {
    expect(classifyProjectPath('src/generated/models/example.ts')).toBe('generated');
    expect(classifyProjectPath('docs/llms.txt')).toBe('generated');
    expect(classifyProjectPath('scripts/generate/paths.ts')).toBe('maintained');
    expect(classifyProjectPath('src/transport.ts')).toBe('maintained');
    expect(classifyProjectPath('tests/runtime.test.ts')).toBe('maintained');
    expect(classifyProjectPath('openapi/corrections/manifest.json')).toBe('maintained');
  });

  it.each([
    ['src/generated/types.gen.ts', 'src/generated/types.gen.ts'],
    ['src\\generated\\types.gen.ts', 'src/generated/types.gen.ts'],
    ['docs\\generated/operations\\GetStatus.md', 'docs/generated/operations/GetStatus.md'],
  ])('normalizes generated path separators in %j', (path, expected) => {
    expect(normalizeGeneratedPath(path)).toBe(expected);
  });

  it.each([
    ['a maintained source file', ['src/transport.ts']],
    ['a parent source tree', ['src']],
    ['a partial generated tree', ['src/generated/models']],
    ['a traversing path', ['src/generated/../../package.json']],
    ['a duplicate target', ['src/generated', 'src/generated']],
  ])('rejects replacing %s', (_description, paths) => {
    expect(() => resolveGeneratedReplacementTargets(paths)).toThrow(
      /generated replacement target|non-generated path/,
    );
  });
});
