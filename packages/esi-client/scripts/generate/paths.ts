import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ProjectPathClassification = 'generated' | 'maintained';
export type GeneratedPathKind = 'source' | 'documentation' | 'examples' | 'tests' | 'openapi';

export const repositoryRoot: string = fileURLToPath(new URL('../../', import.meta.url));

export const generatedPaths: Readonly<Record<GeneratedPathKind, readonly string[]>> = Object.freeze(
  {
    source: Object.freeze(['src/generated']),
    documentation: Object.freeze(['llms.txt', 'docs/generated', 'docs/llms.txt']),
    examples: Object.freeze(['examples/generated']),
    tests: Object.freeze(['tests/generated']),
    openapi: Object.freeze(['openapi/generated']),
  },
);

export const generatedReplacementTargets: readonly string[] = Object.freeze(
  Object.values(generatedPaths).flat(),
);

const approvedTargets = new Set(
  generatedReplacementTargets.map((path) => resolve(repositoryRoot, path)),
);

export function classifyProjectPath(path: string): ProjectPathClassification {
  const absolutePath = resolve(repositoryRoot, path);
  for (const target of approvedTargets) {
    if (absolutePath === target || absolutePath.startsWith(`${target}${sep}`)) return 'generated';
  }
  return 'maintained';
}

export function resolveGeneratedReplacementTargets(
  paths: readonly string[] = generatedReplacementTargets,
): readonly string[] {
  const resolvedPaths: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    const absolutePath = resolve(repositoryRoot, path);
    if (!approvedTargets.has(absolutePath)) {
      throw new Error(`Refusing to replace non-generated path: ${path}`);
    }
    if (seen.has(absolutePath)) {
      throw new Error(`Duplicate generated replacement target: ${path}`);
    }
    seen.add(absolutePath);
    resolvedPaths.push(absolutePath);
  }

  return Object.freeze(resolvedPaths);
}
