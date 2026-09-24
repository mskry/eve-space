import { readFile } from 'node:fs/promises'

const ROOT_MOUNT_SOURCE = 'api/src/index.ts'
const USE_PATTERN = /\.use\(\s*'([^']+)'\s*,([^)]*)\)/g
const ROUTE_PATTERN = /\.route\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g
const ROUTER_IMPORT_PATTERN = /import\s*\{[^}]*\b(\w+)\b[^}]*\}\s*from\s*'(\.[^']+)'/g

interface RouteMount {
  prefix: string
  router: string
  source: string
}

interface RoutePrefixMiddleware {
  pattern: string
  middleware: readonly string[]
}

export interface RootMountTable {
  mounts: readonly RouteMount[]
  prefixMiddleware: readonly RoutePrefixMiddleware[]
}

export interface ResolvedMount {
  mounts: readonly RouteMount[]
  remainder: string
  middleware: readonly string[]
}

export const loadRootMountTable = async (root: URL): Promise<RootMountTable> => {
  const source = await readFile(new URL(ROOT_MOUNT_SOURCE, root), 'utf8')
  const routerSources = collectRouterSources(source)

  return {
    mounts: [...source.matchAll(ROUTE_PATTERN)].map(([, prefix, router]) => ({
      prefix,
      router,
      source: routerSources.get(router) ?? ROOT_MOUNT_SOURCE,
    })),
    prefixMiddleware: [...source.matchAll(USE_PATTERN)].map(([, pattern, argumentList]) => ({
      middleware: identifiersIn(argumentList),
      pattern,
    })),
  }
}

export const resolveMount = (requestPath: string, table: RootMountTable): ResolvedMount => {
  const mounts = longestPrefixMatches(requestPath, table.mounts)
  const prefix = mounts[0]?.prefix ?? ''

  return {
    middleware: [
      ...new Set(
        table.prefixMiddleware
          .filter((entry) => matchesPattern(requestPath, entry.pattern))
          .flatMap((entry) => entry.middleware),
      ),
    ],
    mounts,
    remainder: prefix ? requestPath.slice(prefix.length) || '/' : requestPath,
  }
}

const collectRouterSources = (source: string) => {
  const sources = new Map<string, string>()

  for (const [, identifier, specifier] of source.matchAll(ROUTER_IMPORT_PATTERN)) {
    sources.set(identifier, `api/src/${specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts')}`)
  }

  return sources
}

const identifiersIn = (argumentList: string) =>
  argumentList.includes('=>') || argumentList.includes('(')
    ? []
    : argumentList
        .split(',')
        .map((argument) => argument.trim())
        .filter((argument) => /^\w+$/.test(argument))

const longestPrefixMatches = (requestPath: string, mounts: readonly RouteMount[]) => {
  const matching = mounts.filter(
    (candidate) =>
      requestPath === candidate.prefix || requestPath.startsWith(`${candidate.prefix}/`),
  )
  const longest = matching.reduce(
    (length, candidate) => Math.max(length, candidate.prefix.length),
    0,
  )

  return matching.filter((candidate) => candidate.prefix.length === longest)
}

const matchesPattern = (requestPath: string, pattern: string) =>
  pattern.endsWith('/*')
    ? requestPath.startsWith(pattern.slice(0, -1))
    : pattern === '*' || pattern === requestPath
