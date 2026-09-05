import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ProjectPathClassification = 'generated' | 'maintained';
export type GeneratedPathKind = 'source' | 'documentation' | 'examples' | 'tests' | 'openapi';
export type GeneratedOutputKind = 'file' | 'directory';

/**
 * Stable identity for a generated target. Emitters select by role so adding a target to a
 * category cannot silently change which path an existing emitter writes.
 */
export type GeneratedTargetRole =
  | 'source'
  | 'documentation'
  | 'repositoryLlms'
  | 'siteLlms'
  | 'examples'
  | 'tests'
  | 'openapi';

export interface GeneratedTarget {
  readonly role: GeneratedTargetRole;
  readonly path: string;
  readonly kind: GeneratedOutputKind;
  readonly category: GeneratedPathKind;
}

export const repositoryRoot: string = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The single source of truth for every generated output: its repository path, its filesystem
 * kind, and the category that owns it. Emitters, the replacement transaction, and the staleness
 * check all derive from this list; none of them may restate a target path or kind.
 */
export const generatedTargets: readonly GeneratedTarget[] = Object.freeze([
  Object.freeze({ role: 'source', path: 'src/generated', kind: 'directory', category: 'source' }),
  Object.freeze({
    role: 'repositoryLlms',
    path: 'llms.txt',
    kind: 'file',
    category: 'documentation',
  }),
  Object.freeze({
    role: 'documentation',
    path: 'docs/generated',
    kind: 'directory',
    category: 'documentation',
  }),
  Object.freeze({
    role: 'siteLlms',
    path: 'docs/llms.txt',
    kind: 'file',
    category: 'documentation',
  }),
  Object.freeze({
    role: 'examples',
    path: 'examples/generated',
    kind: 'directory',
    category: 'examples',
  }),
  Object.freeze({ role: 'tests', path: 'tests/generated', kind: 'directory', category: 'tests' }),
  Object.freeze({
    role: 'openapi',
    path: 'openapi/generated',
    kind: 'directory',
    category: 'openapi',
  }),
] as const);

const targetsByPath: ReadonlyMap<string, GeneratedTarget> = new Map(
  generatedTargets.map((target) => [target.path, target]),
);

function pathsFor(category: GeneratedPathKind): readonly string[] {
  return Object.freeze(
    generatedTargets.filter((target) => target.category === category).map(({ path }) => path),
  );
}

export const generatedPaths: Readonly<Record<GeneratedPathKind, readonly string[]>> = Object.freeze(
  {
    source: pathsFor('source'),
    documentation: pathsFor('documentation'),
    examples: pathsFor('examples'),
    tests: pathsFor('tests'),
    openapi: pathsFor('openapi'),
  },
);

export const generatedReplacementTargets: readonly string[] = Object.freeze(
  generatedTargets.map(({ path }) => path),
);

const approvedTargets = new Set(
  generatedReplacementTargets.map((path) => resolve(repositoryRoot, path)),
);

const targetsByRole: ReadonlyMap<GeneratedTargetRole, GeneratedTarget> = new Map(
  generatedTargets.map((target) => [target.role, target]),
);

/** Returns the single declared target for a role. */
export function generatedTargetFor(role: GeneratedTargetRole): GeneratedTarget {
  const target = targetsByRole.get(role);
  if (target === undefined) throw new Error(`Unknown generated target role: ${role}`);
  return target;
}

/** Returns the declared target for a repository path, or undefined when it is not generated. */
export function findGeneratedTarget(path: string): GeneratedTarget | undefined {
  return targetsByPath.get(path);
}

/** Returns the declared targets for a category, preserving manifest order. */
export function generatedTargetsFor(
  ...categories: readonly GeneratedPathKind[]
): readonly GeneratedTarget[] {
  const selected = new Set(categories);
  return Object.freeze(generatedTargets.filter((target) => selected.has(target.category)));
}

/**
 * Maintained configuration the generator reads, as repository-relative paths. Declared here so a
 * caller-supplied project root governs configuration and generated output together; resolving
 * these against different roots would check one tree's output against another tree's config.
 */
export const configPaths = Object.freeze({
  compatibilityDate: 'openapi/compatibility-date.txt',
  correctionManifest: 'openapi/corrections/manifest.json',
  exclusions: 'openapi/config/exclusions.json',
  facadeCatalog: 'openapi/config/naming-overrides.json',
  safetyOverrides: 'openapi/config/safety-overrides.json',
});

export type ConfigPathName = keyof typeof configPaths;

export function resolveConfigPath(
  name: ConfigPathName,
  projectRoot: string = repositoryRoot,
): string {
  return resolve(projectRoot, configPaths[name]);
}

export function normalizeGeneratedPath(path: string): string {
  return path.replaceAll('\\', '/');
}

export function classifyProjectPath(path: string): ProjectPathClassification {
  const absolutePath = resolve(repositoryRoot, path);
  for (const target of approvedTargets) {
    if (absolutePath === target || absolutePath.startsWith(`${target}${sep}`)) return 'generated';
  }
  return 'maintained';
}

/**
 * Rejects any path that is not a declared generated target, or that appears twice. Every
 * destructive step guards on this first: replacement moves a live path aside and rollback
 * removes it recursively, so a target that is not generated output must never reach either.
 */
export function assertGeneratedReplacementTargets(paths: readonly string[]): void {
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
  }
}

export function resolveGeneratedReplacementTargets(
  paths: readonly string[] = generatedReplacementTargets,
): readonly string[] {
  assertGeneratedReplacementTargets(paths);
  return Object.freeze(paths.map((path) => resolve(repositoryRoot, path)));
}
