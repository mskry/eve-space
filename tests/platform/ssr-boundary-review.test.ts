// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { classifySite, formatReport } from '../../scripts/ssr-boundary-review/findings'
import type { SiteJudgment, SiteState } from '../../scripts/ssr-boundary-review/judgments'
import { loadLabelledRequests } from '../../scripts/ssr-boundary-review/labelled-requests'
import {
  changedFrontendFiles,
  collectRequestSites,
} from '../../scripts/ssr-boundary-review/request-sites'
import {
  applicableRouteMiddleware,
  findRouteDefinition,
} from '../../scripts/ssr-boundary-review/route-definitions'
import { loadRootMountTable, resolveMount } from '../../scripts/ssr-boundary-review/route-mounts'

const fixtures = new URL('../fixtures/ssr-boundary-review/', import.meta.url)
const run = promisify(execFile)

const site = (overrides: Partial<SiteState['site']> = {}) =>
  ({
    id: 'app/pages/thing.vue:10',
    file: 'app/pages/thing.vue',
    line: 10,
    entry: 'useQuery',
    excerpt: 'useQuery(...)',
    method: 'GET',
    requestPath: '/api/me/characters/:characterId',
    definitionSource: null,
    definitionExcerpt: null,
    ...overrides,
  }) satisfies SiteState['site']

const state = (overrides: Partial<SiteState> = {}): SiteState => ({
  site: site(),
  rootMiddleware: ['loadSession', 'requireSession'],
  route: {
    source: 'api/src/characters/core-routes.ts',
    method: 'GET',
    path: '/:characterId',
    excerpt: '.get(...)',
    middleware: [],
  },
  ...overrides,
})

const judgment = (overrides: Partial<SiteJudgment> = {}): SiteJudgment => ({
  ssrCapable: 0.9,
  credentialRequirement: { choice: 'owned_character', confidence: 0.95 },
  ssrSafePath: { choice: 'none', confidence: 0.9 },
  credentialsIncludeOnly: 0.1,
  excludedPublicEndpoint: 0.02,
  ...overrides,
})

describe('labelled requests', () => {
  it('rejects route labels without a non-whitespace path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-labelled-requests-'))

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(
        join(root, 'docs/fetching-layer-review-frontend.md'),
        [
          '| `validQuery` | source | SSR-capable | `GET /api/status` | public |',
          `| \`invalidQuery\` | source | SSR-capable | \`GET ${' '.repeat(10_000)}\` | public |`,
        ].join('\n'),
      )

      await expect(loadLabelledRequests(pathToFileURL(`${root}/`))).resolves.toEqual([
        {
          name: 'validQuery',
          method: 'GET',
          requestPath: '/api/status',
          credentialRequirement: 'public',
          ssrGated: false,
          trigger: 'SSR-capable',
        },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('root mount table', () => {
  it('records every router mounted at a shared prefix', async () => {
    const resolved = resolveMount(
      '/api/me/characters/:characterId/mail',
      await loadRootMountTable(fixtures),
    )

    expect(resolved.mounts.map((mount) => mount.source)).toEqual([
      'api/src/characters/routes.ts',
      'api/src/mail/routes.ts',
    ])
  })

  it('ignores inline middleware parameters when collecting middleware names', async () => {
    const resolved = resolveMount('/api/status', await loadRootMountTable(fixtures))

    expect(resolved.middleware).not.toContain('next')
    expect(resolved.middleware).toEqual([])
  })

  it('applies prefix middleware only to matching paths', async () => {
    const table = await loadRootMountTable(fixtures)

    expect(resolveMount('/api/characters/5', table).middleware).toEqual([
      'loadSession',
      'requireSession',
    ])
  })
})

describe('route definitions', () => {
  it('finds a definition in a sibling router mounted at the same prefix', async () => {
    const route = await findRouteDefinition(
      fixtures,
      ['api/src/characters/routes.ts', 'api/src/mail/routes.ts'],
      '/:characterId/mail',
      'GET',
    )

    expect(route?.source).toBe('api/src/mail/routes.ts')
    expect(route?.excerpt).toContain('loadOwnedCharacter')
  })

  it('follows a child router into its own module', async () => {
    const route = await findRouteDefinition(
      fixtures,
      ['api/src/characters/routes.ts'],
      '/:characterId',
      'GET',
    )

    expect(route?.source).toBe('api/src/characters/core-routes.ts')
    expect(route?.middleware).toEqual(['loadSession', 'requireSession', 'loadOrganizationSession'])
  })

  it('combines root and inherited router middleware for model evidence', async () => {
    const route = await findRouteDefinition(
      fixtures,
      ['api/src/characters/routes.ts'],
      '/:characterId',
      'GET',
    )

    expect(applicableRouteMiddleware(['loadSession'], route)).toEqual([
      'loadSession',
      'requireSession',
      'loadOrganizationSession',
    ])
  })
})

describe('request site resolution', () => {
  const sitesInComposable = async () =>
    collectRequestSites(fixtures, ['app/composables/useThing.ts'])

  it('resolves a spread query definition across wrapped lines', async () => {
    const [spread] = await sitesInComposable()

    expect(spread.requestPath).toBe('/api/me/characters/:characterId/mail')
    expect(spread.method).toBe('GET')
  })

  it('does not attribute an adjacent mutation chain to the query above it', async () => {
    const [spread] = await sitesInComposable()

    expect(spread.method).not.toBe('POST')
  })

  it('resolves a query definition returned from a factory arrow', async () => {
    const sites = await sitesInComposable()
    const returned = sites.at(-1)

    expect(returned?.requestPath).toBe('/api/me/characters/:characterId')
  })

  it('carries the query definition body for the model state', async () => {
    const [spread] = await sitesInComposable()

    expect(spread.definitionSource).toContain('mailHeadersQuery')
    expect(spread.definitionExcerpt).toContain('apiClient.api.me.characters')
  })

  it('collects mutations, protected prefetches, direct Hono calls, and $fetch', async () => {
    const sites = await collectRequestSites(fixtures, ['app/composables/requestForms.ts'])

    expect(sites.map(({ entry }) => entry)).toEqual([
      'useMutation',
      'prefetchProtectedQuery',
      '$get',
      '$fetch',
    ])
    expect(sites.map(({ method, requestPath }) => ({ method, requestPath }))).toEqual([
      { method: null, requestPath: null },
      { method: 'GET', requestPath: '/api/status' },
      { method: 'GET', requestPath: '/api/status' },
      { method: 'GET', requestPath: '/api/status' },
    ])
    expect(sites[1].localHelpers).toContain('canRunProtectedCharacterQuery')
    expect(sites[1].localHelpers).toContain('access.isClient')
  })
})

describe('changed frontend files', () => {
  it('includes staged and non-ignored untracked files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-ssr-review-'))

    try {
      await run('git', ['init'], { cwd: root })
      await mkdir(join(root, 'app'), { recursive: true })
      await writeFile(join(root, 'app', 'baseline.ts'), 'export const baseline = true\n')
      await run('git', ['add', '.'], { cwd: root })
      await run(
        'git',
        ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'],
        { cwd: root },
      )

      await writeFile(join(root, 'app', 'staged.ts'), 'export const staged = true\n')
      await run('git', ['add', 'app/staged.ts'], { cwd: root })
      await mkdir(join(root, 'layers'), { recursive: true })
      await writeFile(join(root, 'layers', 'untracked.vue'), '<template><main /></template>\n')

      await expect(changedFrontendFiles(root, 'HEAD')).resolves.toEqual([
        'app/staged.ts',
        'layers/untracked.vue',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('finding classification', () => {
  it('reports an ungated SSR-capable request to a credentialed route', () => {
    expect(classifySite(state(), judgment()).verdict).toBe('report')
  })

  it('passes a request gated behind a confident client-only gate', () => {
    const gated = judgment({ ssrSafePath: { choice: 'client_only_gate', confidence: 0.93 } })

    expect(classifySite(state(), gated).verdict).toBe('pass')
  })

  it('routes a barely-supported gate claim to human review', () => {
    const uncertain = judgment({ ssrSafePath: { choice: 'client_only_gate', confidence: 0.2 } })

    expect(classifySite(state(), uncertain).verdict).toBe('review')
  })

  it('trusts a moderately confident gate, which labelled-gated requests routinely produce', () => {
    const moderate = judgment({ ssrSafePath: { choice: 'client_only_gate', confidence: 0.47 } })

    expect(classifySite(state(), moderate).verdict).toBe('pass')
  })

  it('passes a request that cannot execute during SSR', () => {
    expect(classifySite(state(), judgment({ ssrCapable: 0.05 })).verdict).toBe('pass')
  })

  it('does not skip at the score labelled-gated requests occupy', () => {
    expect(classifySite(state(), judgment({ ssrCapable: 0.31 })).verdict).not.toBe('pass')
  })

  it('passes an excluded status endpoint', () => {
    expect(classifySite(state(), judgment({ excludedPublicEndpoint: 0.95 })).verdict).toBe('pass')
  })

  it('passes a confidently public route', () => {
    const publicRoute = judgment({
      credentialRequirement: { choice: 'public', confidence: 0.97 },
    })

    expect(classifySite(state(), publicRoute).verdict).toBe('pass')
  })

  it('keeps an unknown credential requirement in manual review', () => {
    const unknownRoute = judgment({
      credentialRequirement: { choice: 'unknown', confidence: 0.99 },
    })

    expect(classifySite(state(), unknownRoute).verdict).toBe('review')
  })

  it('reports an ungated request even when ssr_capable scores low', () => {
    expect(classifySite(state(), judgment({ ssrCapable: 0.32 })).verdict).toBe('report')
  })

  it('routes a low-confidence credential requirement to human review', () => {
    const unsure = judgment({
      credentialRequirement: { choice: 'organization_permission', confidence: 0.43 },
    })

    expect(classifySite(state(), unsure).verdict).toBe('review')
  })

  it('names the cookie-forwarding trap when the call relies on credentials include', () => {
    const finding = classifySite(state(), judgment({ credentialsIncludeOnly: 0.9 }))

    expect(finding.reason).toContain("credentials: 'include'")
  })

  it('names both the call site and the route mount', () => {
    const finding = classifySite(state(), judgment())

    expect(formatReport([finding])).toContain('app/pages/thing.vue:10')
    expect(formatReport([finding])).toContain('api/src/characters/core-routes.ts')
  })

  it('summarises a clean review', () => {
    const clean = classifySite(state(), judgment({ ssrCapable: 0.05 }))

    expect(formatReport([clean])).toContain('No SSR boundary findings')
  })
})
