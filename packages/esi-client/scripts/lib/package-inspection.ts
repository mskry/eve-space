import { posix } from 'node:path';

import { initSync, parse } from 'es-module-lexer';
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast';

export interface PackedFile {
  readonly path: string;
  readonly size?: number;
  readonly source?: string;
}

export interface PackedPackageManifest {
  readonly exports?: { readonly [entry: string]: unknown };
  readonly dependencies?: { readonly [name: string]: string };
  readonly optionalDependencies?: { readonly [name: string]: string };
  readonly peerDependencies?: { readonly [name: string]: string };
}

export interface PackedPackageBoundaryResult {
  readonly forbiddenPaths: readonly string[];
  readonly operationExportTargets: readonly string[];
}

export interface PackageMeasurements {
  packageVersion: string;
  totals: { [metric: string]: number };
  publicEntries: {
    [entry: string]: {
      runtime: PackedArtifactGraph;
      declaration: PackedArtifactGraph;
    };
  };
  files: string[];
}

export interface PackedArtifactExternalEdge {
  from: string;
  specifier: string;
}

export interface PackedArtifactGraph {
  target: string;
  files: string[];
  externalEdges: PackedArtifactExternalEdge[];
  uniqueBytes: number;
}

export interface PackageBudgetBaseline {
  schemaVersion: number;
  policy: {
    byteHeadroomPercent: number;
    fileCountHeadroom: number;
    description: string;
  };
  totals: {
    [metric: string]: { measured: number; maximum: number };
  };
  publicEntries: {
    [entry: string]: {
      runtime: PackageEntryBudget;
      declaration: PackageEntryBudget;
    };
  };
  allowedFiles: string[];
}

export interface PackageEntryBudget {
  target: string;
  files: string[];
  externalEdges: PackedArtifactExternalEdge[];
  measuredUniqueBytes: number;
  maximumUniqueBytes: number;
}

interface NormalizedPackedFile {
  readonly path: string;
  readonly size: number;
  readonly source: string | undefined;
}

interface ArtifactEdgeContext {
  readonly approved: ReadonlySet<string>;
  readonly artifacts: ReadonlyMap<string, NormalizedPackedFile>;
  readonly externalEdges: Map<string, PackedArtifactExternalEdge>;
  readonly kind: 'runtime' | 'declaration';
  readonly pending: string[];
  readonly reachable: Set<string>;
}

export const forbiddenPackagePaths: readonly string[] = Object.freeze([
  'llms.txt',
  'docs/llms.txt',
  'docs/generated/',
  'examples/generated/',
  'openapi/config/',
]);

export const packageBudgetSchemaVersion = 2;
export const packageBudgetByteHeadroomPercent = 2;
export const packageBudgetFileCountHeadroom = 0;
export const expectedDomainEntryCount = 39;

const totalByteMetrics = Object.freeze([
  'compressedBytes',
  'unpackedBytes',
  'javascriptBytes',
  'declarationBytes',
]);
const totalMetrics = Object.freeze([...totalByteMetrics, 'fileCount']);
const unsupportedRequirePattern = /\brequire(?:\.resolve)?\s*\(/u;

initSync();

export function findForbiddenPackedPaths(files: readonly PackedFile[]): readonly string[] {
  const paths = files.map((file) => normalizePackedPath(file.path));
  return paths
    .filter((path) =>
      forbiddenPackagePaths.some((forbidden) =>
        forbidden.endsWith('/') ? path.startsWith(forbidden) : path === forbidden,
      ),
    )
    .toSorted(compareText);
}

export function validatePackedPackageBoundary(
  files: readonly PackedFile[],
  packageJson: PackedPackageManifest,
): PackedPackageBoundaryResult {
  if (!Array.isArray(files)) throw new TypeError('Packed files must be an array');
  const forbidden = findForbiddenPackedPaths(files);
  if (forbidden.length > 0) {
    throw new Error(`Packed documentation artifacts are forbidden: ${forbidden.join(', ')}`);
  }

  const operationsExport = packageJson?.exports?.['./operations'];
  const targets = [
    ...new Set(
      collectExportTargets(operationsExport).map((path) =>
        normalizePackedPath(path.replace(/^\.\//u, '')),
      ),
    ),
  ];
  if (targets.length === 0) {
    throw new Error('Package must export runtime operation metadata through ./operations');
  }
  const packedPaths = new Set(files.map((file) => normalizePackedPath(file.path)));
  if (packageJson?.exports?.['./package.json'] !== './package.json') {
    throw new Error('Package must export ./package.json as package metadata');
  }
  if (!packedPaths.has('package.json')) {
    throw new Error('Packed package is missing its package.json metadata export target');
  }
  const missingTargets = targets.filter((path) => !packedPaths.has(path));
  if (missingTargets.length > 0) {
    throw new Error(`Packed ./operations export targets are missing: ${missingTargets.join(', ')}`);
  }
  if (!targets.some((path) => path.endsWith('.js'))) {
    throw new Error('Package ./operations export must include a runtime JavaScript target');
  }

  return { forbiddenPaths: forbidden, operationExportTargets: targets.toSorted(compareText) };
}

export function measurePackedPackage(
  pack: {
    readonly size: number;
    readonly unpackedSize: number;
    readonly entryCount?: number;
    readonly files: readonly PackedFile[];
  },
  packageJson: PackedPackageManifest & { readonly version?: string },
): PackageMeasurements {
  if (pack === null || typeof pack !== 'object')
    throw new TypeError('Pack result must be an object');
  if (!Array.isArray(pack.files)) throw new TypeError('Packed files must be an array');

  const files: NormalizedPackedFile[] = pack.files.map((file) => ({
    path: normalizePackedPath(file.path),
    size: requireNonnegativeInteger(file.size, `Packed file ${String(file.path)} size`),
    source: file.source,
  }));
  const duplicatePaths = findDuplicates(files.map(({ path }) => path));
  if (duplicatePaths.length > 0) {
    throw new Error(`Packed package contains duplicate paths: ${duplicatePaths.join(', ')}`);
  }

  const approvedExternalPackages = collectDeclaredExternalPackages(packageJson);
  const publicEntries: PackageMeasurements['publicEntries'] = {};
  for (const [entryName, targets] of collectPublicEntryTargets(packageJson)) {
    publicEntries[entryName] = {
      runtime: tracePackedArtifactGraph(
        files,
        targets.runtime,
        'runtime',
        approvedExternalPackages,
      ),
      declaration: tracePackedArtifactGraph(
        files,
        targets.declaration,
        'declaration',
        approvedExternalPackages,
      ),
    };
  }

  return {
    packageVersion: requireNonemptyString(packageJson?.version, 'Package version'),
    totals: {
      compressedBytes: requireNonnegativeInteger(pack.size, 'Compressed package size'),
      unpackedBytes: requireNonnegativeInteger(pack.unpackedSize, 'Unpacked package size'),
      javascriptBytes: sumFileSizes(files, (path) => path.endsWith('.js')),
      declarationBytes: sumFileSizes(files, (path) => /\.d\.(?:ts|mts|cts)$/u.test(path)),
      fileCount: requireNonnegativeInteger(pack.entryCount ?? files.length, 'Packed file count'),
    },
    publicEntries,
    files: files.map(({ path }) => path).toSorted(compareText),
  };
}

export function tracePackedArtifactGraph(
  files: readonly PackedFile[],
  target: string,
  kind: 'runtime' | 'declaration',
  approvedExternalPackages: readonly string[] = [],
): PackedArtifactGraph {
  if (kind !== 'runtime' && kind !== 'declaration') {
    throw new TypeError(
      `Packed artifact graph kind must be runtime or declaration, received ${String(kind)}`,
    );
  }
  const normalizedTarget = normalizePackedPath(target);
  const normalizedFiles: NormalizedPackedFile[] = files.map((file) => ({
    path: normalizePackedPath(file.path),
    size: requireNonnegativeInteger(file.size, `Packed artifact ${file.path} size`),
    source: file.source,
  }));
  const artifacts = new Map(normalizedFiles.map((file) => [file.path, file]));
  const duplicatePaths = findDuplicates(normalizedFiles.map((file) => file.path));
  if (duplicatePaths.length > 0) {
    throw new Error(`Packed package contains duplicate paths: ${duplicatePaths.join(', ')}`);
  }
  const approved = new Set(approvedExternalPackages);
  const reachable = new Set<string>();
  const externalEdges = new Map<string, PackedArtifactExternalEdge>();
  const pending = [normalizedTarget];
  const edgeContext: ArtifactEdgeContext = {
    approved,
    artifacts,
    externalEdges,
    kind,
    pending,
    reachable,
  };

  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || reachable.has(path)) continue;
    const artifact = artifacts.get(path);
    if (artifact === undefined) {
      throw new Error(`Packed ${kind} graph target is missing: ${path}`);
    }
    if (typeof artifact.source !== 'string') {
      throw new TypeError(`Packed ${kind} graph artifact source is unavailable: ${path}`);
    }
    reachable.add(path);

    for (const specifier of parseArtifactImports(artifact.source, path, kind))
      collectArtifactEdge(path, specifier, edgeContext);
  }

  const reachableFiles = [...reachable].toSorted(compareText);
  return {
    target: normalizedTarget,
    files: reachableFiles,
    externalEdges: [...externalEdges.values()].toSorted(compareExternalEdges),
    uniqueBytes: reachableFiles.reduce((total, path) => {
      const artifact = artifacts.get(path);
      return total + (artifact === undefined ? 0 : artifact.size);
    }, 0),
  };
}

function collectArtifactEdge(path: string, specifier: string, context: ArtifactEdgeContext): void {
  const { approved, artifacts, externalEdges, kind, pending, reachable } = context;
  if (isRelativeSpecifier(specifier)) {
    const resolved = resolvePackedRelativeEdge(path, specifier, kind, artifacts);
    if (!reachable.has(resolved)) pending.push(resolved);
    return;
  }
  if (isUnsupportedSpecifier(specifier)) {
    throw new Error(`Packed ${kind} graph has unsupported edge from ${path}: ${specifier}`);
  }
  const packageName = externalPackageName(specifier);
  if (!approved.has(packageName)) {
    throw new Error(`Packed ${kind} graph has undeclared external edge from ${path}: ${specifier}`);
  }
  const key = `${path}\0${specifier}`;
  externalEdges.set(key, { from: path, specifier });
}

export function validateDomainEntryIsolation(
  measurements: PackageMeasurements,
  expectedCount: number = expectedDomainEntryCount,
): { domainEntryCount: number } {
  const entries = Object.entries(measurements.publicEntries).filter(([entryName]) =>
    entryName.startsWith('./domains/'),
  );
  if (entries.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} public domain entries, received ${entries.length}`);
  }

  const domains = new Set(entries.map(([entryName]) => entryName.slice('./domains/'.length)));
  const issues: string[] = [];
  for (const [entryName, entry] of entries) {
    const domain = entryName.slice('./domains/'.length);
    for (const kind of ['runtime', 'declaration'] as const) {
      for (const path of entry[kind].files) {
        const forbiddenReason = domainIsolationViolation(path, domain, domains);
        if (forbiddenReason !== undefined) {
          issues.push(`${entryName} ${kind} reaches ${path} (${forbiddenReason})`);
        }
      }
    }
  }
  if (issues.length > 0) {
    throw new Error(`Domain entry isolation failed:\n- ${issues.join('\n- ')}`);
  }

  return { domainEntryCount: entries.length };
}

export function validateDomainDeclarationSurface(
  measurements: PackageMeasurements,
  files: readonly PackedFile[],
  expectedCount: number = expectedDomainEntryCount,
): { domainEntryCount: number } {
  const entries = Object.entries(measurements.publicEntries).filter(([entryName]) =>
    entryName.startsWith('./domains/'),
  );
  if (entries.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} public domain entries, received ${entries.length}`);
  }
  const sources = new Map(files.map((file) => [normalizePackedPath(file.path), file.source]));
  const issues: string[] = [];
  for (const [entryName, entry] of entries) {
    for (const path of entry.declaration.files) {
      const source = sources.get(path);
      if (typeof source !== 'string') {
        issues.push(`${entryName} declaration source is unavailable: ${path}`);
      } else if (/\bEsiClientConfiguration\b/u.test(source)) {
        issues.push(`${entryName} declaration reaches internal EsiClientConfiguration in ${path}`);
      }
    }
  }
  if (issues.length > 0) {
    throw new Error(`Domain declaration surface validation failed:\n- ${issues.join('\n- ')}`);
  }
  return { domainEntryCount: entries.length };
}

export function createPackageBudgetBaseline(
  measurements: PackageMeasurements,
): PackageBudgetBaseline {
  const publicEntries: PackageBudgetBaseline['publicEntries'] = {};
  for (const [entryName, entry] of Object.entries(measurements.publicEntries)) {
    publicEntries[entryName] = {
      runtime: createEntryBudget(entry.runtime),
      declaration: createEntryBudget(entry.declaration),
    };
  }

  const totals: PackageBudgetBaseline['totals'] = {};
  for (const metric of totalMetrics) {
    const measured = measurements.totals[metric];
    totals[metric] = {
      measured,
      maximum:
        metric === 'fileCount' ? measured + packageBudgetFileCountHeadroom : maximumBytes(measured),
    };
  }

  return {
    schemaVersion: packageBudgetSchemaVersion,
    policy: {
      byteHeadroomPercent: packageBudgetByteHeadroomPercent,
      fileCountHeadroom: packageBudgetFileCountHeadroom,
      description:
        'Byte maxima are accepted unique transitive measurements plus 2%; reachable files, external edges, file count, and packed paths have no headroom, so every graph or artifact change requires review.',
    },
    totals,
    publicEntries,
    allowedFiles: [...measurements.files],
  };
}

export function validatePackageBudgets(
  measurements: PackageMeasurements,
  baseline: PackageBudgetBaseline,
): void {
  const issues: string[] = [];
  if (baseline?.schemaVersion !== packageBudgetSchemaVersion) {
    issues.push(
      `budget schema version must be ${packageBudgetSchemaVersion}, received ${String(baseline?.schemaVersion)}`,
    );
  }
  validateBudgetPolicy(baseline?.policy, issues);

  const budgetTotals = isRecord(baseline?.totals) ? baseline.totals : {};
  compareKeys('total metric budgets', totalMetrics, Object.keys(budgetTotals), issues);
  for (const metric of totalMetrics) {
    const budget = budgetTotals[metric];
    if (!validateTotalBudget(metric, budget, issues)) continue;
    const actual = measurements.totals[metric];
    if (actual > budget.maximum) {
      issues.push(`${metric} is ${actual}, exceeding budget ${budget.maximum}`);
    }
  }

  const measuredEntries = measurements.publicEntries;
  const budgetEntries = isRecord(baseline?.publicEntries) ? baseline.publicEntries : {};
  compareKeys(
    'public entry budgets',
    Object.keys(measuredEntries),
    Object.keys(budgetEntries),
    issues,
  );
  for (const entryName of Object.keys(measuredEntries)) {
    const measuredEntry = measuredEntries[entryName];
    const budgetEntry = budgetEntries[entryName];
    if (!isRecord(budgetEntry)) continue;
    compareKeys(
      `public entry ${entryName} artifact budgets`,
      ['runtime', 'declaration'],
      Object.keys(budgetEntry),
      issues,
    );
    validateEntryBudget(entryName, 'runtime', measuredEntry.runtime, budgetEntry.runtime, issues);
    validateEntryBudget(
      entryName,
      'declaration',
      measuredEntry.declaration,
      budgetEntry.declaration,
      issues,
    );
  }

  const allowedFiles = Array.isArray(baseline?.allowedFiles) ? baseline.allowedFiles : [];
  compareKeys('packed files', allowedFiles, measurements.files, issues);

  if (issues.length > 0) {
    throw new Error(`Package budget validation failed:\n- ${issues.join('\n- ')}`);
  }
}

function collectPublicEntryTargets(
  packageJson: PackedPackageManifest,
): [string, { runtime: string; declaration: string }][] {
  if (!isRecord(packageJson?.exports)) throw new Error('Package exports must be an object');
  return Object.entries(packageJson.exports).flatMap(([entryName, entry]) => {
    if (typeof entry === 'string') {
      if (entryName === './package.json' && entry === './package.json') return [];
      throw new Error(`Public metadata entry ${entryName} must target ./package.json`);
    }
    if (!isRecord(entry)) {
      throw new Error(`Public entry ${entryName} must declare explicit import and types targets`);
    }
    return [
      [
        entryName,
        {
          runtime: normalizePackedPath(
            requireNonemptyString(entry.import, `Public entry ${entryName} import target`).replace(
              /^\.\//u,
              '',
            ),
          ),
          declaration: normalizePackedPath(
            requireNonemptyString(entry.types, `Public entry ${entryName} types target`).replace(
              /^\.\//u,
              '',
            ),
          ),
        },
      ] as [string, { runtime: string; declaration: string }],
    ];
  });
}

function createEntryBudget(measurement: PackedArtifactGraph): PackageEntryBudget {
  return {
    target: measurement.target,
    files: [...measurement.files],
    externalEdges: measurement.externalEdges.map((edge) => ({ ...edge })),
    measuredUniqueBytes: measurement.uniqueBytes,
    maximumUniqueBytes: maximumBytes(measurement.uniqueBytes),
  };
}

function maximumBytes(measuredBytes: number): number {
  return Math.ceil((measuredBytes * (100 + packageBudgetByteHeadroomPercent)) / 100);
}

function validateBudgetPolicy(policy: unknown, issues: string[]): void {
  if (!isRecord(policy)) {
    issues.push('budget policy is missing');
    return;
  }
  if (policy.byteHeadroomPercent !== packageBudgetByteHeadroomPercent) {
    issues.push(`budget byte headroom must be ${packageBudgetByteHeadroomPercent}%`);
  }
  if (policy.fileCountHeadroom !== packageBudgetFileCountHeadroom) {
    issues.push(`budget file-count headroom must be ${packageBudgetFileCountHeadroom}`);
  }
  if (typeof policy.description !== 'string' || policy.description.length === 0) {
    issues.push('budget policy description is missing');
  }
}

function validateTotalBudget(
  metric: string,
  budget: unknown,
  issues: string[],
): budget is { measured: number; maximum: number } {
  if (!isRecord(budget)) return false;
  const measured = budget.measured;
  const maximum = budget.maximum;
  if (typeof measured !== 'number' || !Number.isSafeInteger(measured) || measured < 0) {
    issues.push(`${metric} accepted measurement must be a nonnegative integer`);
    return false;
  }
  const expectedMaximum =
    metric === 'fileCount' ? measured + packageBudgetFileCountHeadroom : maximumBytes(measured);
  if (maximum !== expectedMaximum) {
    issues.push(`${metric} budget must be ${expectedMaximum} for accepted measurement ${measured}`);
    return false;
  }
  return true;
}

function validateEntryBudget(
  entryName: string,
  kind: 'runtime' | 'declaration',
  measurement: PackedArtifactGraph,
  budget: unknown,
  issues: string[],
): void {
  if (!isRecord(budget)) {
    issues.push(`public entry ${entryName} is missing its ${kind} budget`);
    return;
  }
  const budgetTarget = budget.target;
  if (typeof budgetTarget !== 'string') {
    issues.push(`public entry ${entryName} ${kind} budget is missing its target`);
  } else if (budgetTarget !== measurement.target) {
    issues.push(
      `public entry ${entryName} ${kind} target changed from ${budgetTarget} to ${measurement.target}`,
    );
  }
  validateExactList(
    `public entry ${entryName} ${kind} reachable files`,
    budget.files,
    measurement.files,
    issues,
  );
  validateExternalEdges(entryName, kind, budget.externalEdges, measurement.externalEdges, issues);
  const measuredUniqueBytes = budget.measuredUniqueBytes;
  if (
    typeof measuredUniqueBytes !== 'number' ||
    !Number.isSafeInteger(measuredUniqueBytes) ||
    measuredUniqueBytes < 0
  ) {
    issues.push(
      `public entry ${entryName} ${kind} accepted unique measurement must be nonnegative`,
    );
    return;
  }
  const expectedMaximum = maximumBytes(measuredUniqueBytes);
  if (budget.maximumUniqueBytes !== expectedMaximum) {
    issues.push(
      `public entry ${entryName} ${kind} budget must be ${expectedMaximum} for accepted unique measurement ${measuredUniqueBytes}`,
    );
    return;
  }
  if (measurement.uniqueBytes > budget.maximumUniqueBytes) {
    issues.push(
      `public entry ${entryName} ${kind} is ${measurement.uniqueBytes} unique bytes, exceeding budget ${budget.maximumUniqueBytes}`,
    );
  }
}

function validateExactList(
  label: string,
  expected: unknown,
  actual: readonly string[],
  issues: string[],
): void {
  if (!Array.isArray(expected)) {
    issues.push(`${label} are missing`);
    return;
  }
  if (expected.some((value) => typeof value !== 'string')) {
    issues.push(`${label} must contain only strings`);
    return;
  }
  const canonical = [...new Set(expected)].toSorted(compareText);
  if (JSON.stringify(expected) !== JSON.stringify(canonical)) {
    issues.push(`${label} must be sorted and unique`);
  }
  compareKeys(label, expected, actual, issues);
}

function validateExternalEdges(
  entryName: string,
  kind: string,
  expected: unknown,
  actual: readonly PackedArtifactExternalEdge[],
  issues: string[],
): void {
  const label = `public entry ${entryName} ${kind} external edges`;
  if (!Array.isArray(expected)) {
    issues.push(`${label} are missing`);
    return;
  }
  const expectedKeys: string[] = [];
  for (const edge of expected) {
    if (!isRecord(edge) || typeof edge.from !== 'string' || typeof edge.specifier !== 'string') {
      issues.push(`${label} must contain from/specifier records`);
      return;
    }
    expectedKeys.push(`${edge.from} -> ${edge.specifier}`);
  }
  const canonical = [...new Set(expectedKeys)].toSorted(compareText);
  if (JSON.stringify(expectedKeys) !== JSON.stringify(canonical)) {
    issues.push(`${label} must be sorted and unique`);
  }
  compareKeys(
    label,
    expectedKeys,
    actual.map((edge) => `${edge.from} -> ${edge.specifier}`),
    issues,
  );
}

function parseArtifactImports(
  source: string,
  path: string,
  kind: 'runtime' | 'declaration',
): string[] {
  assertNoUnsupportedDependencySyntax(source, path, kind);
  const analyzableSource = kind === 'declaration' ? maskDeclarationTypeModifiers(source) : source;
  let imports;
  try {
    [imports] = parse(analyzableSource, path);
  } catch (error) {
    throw new Error(
      `Cannot analyze packed ${kind} artifact ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const specifiers: string[] = [];
  for (const entry of imports) {
    if (entry.d === -2) continue;
    if (entry.d >= 0 && entry.n === undefined) {
      throw new Error(`Packed ${kind} graph has nonliteral dynamic import in ${path}`);
    }
    if (entry.n === undefined) {
      throw new Error(`Packed ${kind} graph has an unsupported import in ${path}`);
    }
    specifiers.push(entry.n);
  }
  return [...new Set(specifiers)];
}

function assertNoUnsupportedDependencySyntax(
  source: string,
  path: string,
  kind: 'runtime' | 'declaration',
): void {
  if (unsupportedRequirePattern.test(source)) {
    throw new Error(`Packed ${kind} graph has unsupported require syntax in ${path}`);
  }
}

function maskDeclarationTypeModifiers(source: string): string {
  const characters = source.split('');
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  let previousKind;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (
      kind === SyntaxKind.TypeKeyword &&
      (previousKind === SyntaxKind.ExportKeyword || previousKind === SyntaxKind.ImportKeyword)
    ) {
      characters.fill(' ', scanner.getTokenStart(), scanner.getTokenEnd());
    }
    previousKind = kind;
  }
  return characters.join('');
}

function resolvePackedRelativeEdge(
  from: string,
  specifier: string,
  kind: 'runtime' | 'declaration',
  artifacts: ReadonlyMap<string, NormalizedPackedFile>,
): string {
  const joined = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (joined === '..' || joined.startsWith('../') || posix.isAbsolute(joined)) {
    throw new Error(`Packed ${kind} graph edge escapes the package from ${from}: ${specifier}`);
  }
  const candidates =
    kind === 'declaration'
      ? declarationResolutionCandidates(joined)
      : runtimeResolutionCandidates(joined);
  const matches = candidates.filter((candidate) => artifacts.has(candidate));
  if (matches.length === 0) {
    throw new Error(
      `Packed ${kind} graph edge from ${from} is missing its target: ${specifier} (${candidates.join(', ')})`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Packed ${kind} graph edge from ${from} resolves ambiguously: ${specifier} (${matches.join(', ')})`,
    );
  }
  return matches[0];
}

function declarationResolutionCandidates(path: string): string[] {
  if (path.endsWith('.js')) return [path.slice(0, -3) + '.d.ts'];
  if (path.endsWith('.mjs')) return [path.slice(0, -4) + '.d.mts'];
  if (path.endsWith('.cjs')) return [path.slice(0, -4) + '.d.cts'];
  if (/\.d\.(?:ts|mts|cts)$/u.test(path)) return [path];
  if (posix.extname(path) === '') return [`${path}.d.ts`, `${path}/index.d.ts`];
  return [path];
}

function runtimeResolutionCandidates(path: string): string[] {
  if (posix.extname(path) !== '') return [path];
  return [`${path}.js`, `${path}/index.js`];
}

function collectDeclaredExternalPackages(packageJson: PackedPackageManifest): string[] {
  return [
    ...new Set(
      (['dependencies', 'optionalDependencies', 'peerDependencies'] as const).flatMap((field) =>
        isRecord(packageJson?.[field]) ? Object.keys(packageJson[field]) : [],
      ),
    ),
  ];
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function isUnsupportedSpecifier(specifier: string): boolean {
  return (
    specifier.length === 0 ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    /^[a-z][a-z\d+.-]*:/iu.test(specifier)
  );
}

function externalPackageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function domainIsolationViolation(
  path: string,
  domain: string,
  domains: ReadonlySet<string>,
): string | undefined {
  if (/^dist\/root(?:\.d\.ts|\.js)$/u.test(path)) return 'aggregate root';
  if (/^dist\/operations(?:\d+)?(?:\.d\.ts|\.js)$/u.test(path)) {
    return 'global operation discovery';
  }
  if (/^dist\/(?:index|manifest|registry)(?:\d+)?(?:\.d\.ts|\.js)$/u.test(path)) {
    return 'aggregate operation registry or discovery';
  }
  if (path.startsWith('dist/operations/')) return 'global operation discovery entry';

  const domainEntry = /^dist\/domains\/([^/]+?)(?:\.d\.ts|\.js)$/u.exec(path)?.[1];
  if (domainEntry !== undefined && domainEntry !== domain) return `unrelated ${domainEntry} entry`;

  const chunk = packedChunkName(path);
  if (chunk !== undefined && domains.has(chunk) && chunk !== domain) {
    return `unrelated ${chunk} implementation or operation schema`;
  }
  return undefined;
}

function packedChunkName(path: string): string | undefined {
  if (!path.startsWith('dist/')) return undefined;
  const fileName = path.slice('dist/'.length);
  if (fileName.includes('/')) return undefined;

  let extension;
  if (fileName.endsWith('.d.ts')) extension = '.d.ts';
  else if (fileName.endsWith('.js')) extension = '.js';
  else return undefined;

  const baseName = fileName.slice(0, -extension.length);
  let end = baseName.length;
  while (end > 1 && isAsciiDigit(baseName.codePointAt(end - 1))) end -= 1;
  return baseName.slice(0, end);
}

function isAsciiDigit(codePoint: number | undefined): boolean {
  return codePoint !== undefined && codePoint >= 48 && codePoint <= 57;
}

function compareExternalEdges(
  left: PackedArtifactExternalEdge,
  right: PackedArtifactExternalEdge,
): number {
  return compareText(left.from, right.from) || compareText(left.specifier, right.specifier);
}

function compareKeys(
  label: string,
  expected: readonly string[],
  actual: readonly string[],
  issues: string[],
): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = [...expectedSet].filter((value) => !actualSet.has(value)).toSorted(compareText);
  const stale = [...actualSet].filter((value) => !expectedSet.has(value)).toSorted(compareText);
  if (missing.length > 0) issues.push(`${label} missing: ${missing.join(', ')}`);
  if (stale.length > 0) issues.push(`${label} stale or unexpected: ${stale.join(', ')}`);
}

function sumFileSizes(
  files: readonly NormalizedPackedFile[],
  predicate: (path: string) => boolean,
): number {
  return files.reduce((total, file) => total + (predicate(file.path) ? file.size : 0), 0);
}

function requireNonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative integer`);
  }
  return value;
}

function requireNonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].toSorted(compareText);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectExportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value).flatMap(collectExportTargets);
}

function normalizePackedPath(path: string): string {
  return path
    .replace(/^\.\//u, '')
    .replace(/^package\//u, '')
    .replaceAll('\\', '/');
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
