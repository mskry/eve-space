import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  nuxtSourceBoundaryViolations,
  serverSourceBoundaryViolations,
} from '../../scripts/module-registry/feature-boundaries'

const root = process.cwd()
const moduleRoot = join(root, 'features/member-audit')

describe('Member Audit reviewer adoption', () => {
  test('publishes the exact permission, profile, and contribution catalog', async () => {
    const manifest = JSON.parse(
      await readFile(join(moduleRoot, 'manifest/manifest.json'), 'utf8'),
    ) as {
      permissions: { audiences: string[]; key: string }[]
      permissionProfiles: { id: string; permissions: string[] }[]
      reviewerContributions: { directoryPermission?: string; id: string; routeId: string }[]
      server: { routes: { id: string; target?: string }[] }
      nuxt: { navigation: unknown[]; pages: unknown[] }
    }

    expect(manifest.permissions.map(({ key }) => key)).toStrictEqual([
      'member-audit.assets.read',
      'member-audit.groups.manage',
      'member-audit.mail.read',
      'member-audit.members.block',
      'member-audit.search',
      'member-audit.skills.read',
      'member-audit.summary.read',
      'member-audit.wallet.read',
    ])
    expect(manifest.permissions.every(({ audiences }) => audiences.includes('hr'))).toBe(true)
    expect(manifest.permissions.every(({ audiences }) => audiences.includes('director'))).toBe(true)
    expect(manifest.permissionProfiles.map(({ id }) => id)).toStrictEqual([
      'access-management',
      'evidence-review',
      'member-review',
    ])
    expect(manifest.reviewerContributions.map(({ id }) => id)).toStrictEqual([
      'overview',
      'trained-skills',
      'assets',
      'wallet',
      'mail',
      'ordinary-groups',
      'member-block',
    ])
    expect(
      manifest.reviewerContributions.every(
        ({ directoryPermission }) => directoryPermission === 'member-audit.search',
      ),
    ).toBe(true)
    expect(manifest.server.routes.some(({ id }) => id === 'member-search')).toBe(false)
    expect(
      manifest.server.routes.every(
        ({ target }) =>
          target === 'managed-organization-account' || target === 'managed-organization-character',
      ),
    ).toBe(true)
    expect(manifest.nuxt.pages).toStrictEqual([])
    expect(manifest.nuxt.navigation).toStrictEqual([])
  })

  test('passes the external source boundary with only bounded platform capabilities', async () => {
    const serverSources = await loadSources(join(moduleRoot, 'server/src'))
    const nuxtSources = await loadSources(join(moduleRoot, 'nuxt/src'))
    const serverViolations = serverSources.flatMap(({ path, source }) =>
      serverSourceBoundaryViolations({
        boundaryRoot: join(moduleRoot, 'server/src'),
        moduleId: 'member-audit',
        path,
        source,
      }),
    )
    const nuxtViolations = nuxtSources.flatMap(({ path, source }) =>
      nuxtSourceBoundaryViolations({
        boundaryRoot: join(moduleRoot, 'nuxt/src'),
        moduleId: 'member-audit',
        path,
        source,
      }),
    )

    expect(serverViolations).toStrictEqual([])
    expect(nuxtViolations).toStrictEqual([])
  }, 30_000)

  test('exports panels without a reusable model or cross-feature barrel', async () => {
    const packageJson = JSON.parse(
      await readFile(join(moduleRoot, 'nuxt/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> }
    const exports = Object.keys(packageJson.exports)

    expect(exports).toHaveLength(8)
    expect(exports.filter((entry) => entry.startsWith('./reviewer/'))).toHaveLength(7)
    expect(exports.some((entry) => entry.includes('model'))).toBe(false)
    expect(exports.some((entry) => entry.includes('directory'))).toBe(false)
  })
})

async function loadSources(directory: string) {
  const paths = await readdir(directory, { recursive: true })
  return Promise.all(
    paths
      .filter((path) => ['.ts', '.vue'].includes(extname(path)))
      .map(async (path) => {
        const absolutePath = join(directory, path)
        return { path: absolutePath, source: await readFile(absolutePath, 'utf8') }
      }),
  )
}
