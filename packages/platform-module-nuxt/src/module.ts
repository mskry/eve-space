import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import {
  addTemplate,
  addTypeTemplate,
  addImports,
  addRouteMiddleware,
  createResolver,
  defineNuxtModule,
  resolvePath,
} from '@nuxt/kit'
import type { NuxtModule, NuxtPage } from '@nuxt/schema'
import {
  platformCoreNavigation,
  type PlatformNuxtContributionDescriptor,
} from '@eve-space/platform-module-contract'

interface PlatformNuxtModuleOptions {
  readonly contributions?: readonly PlatformNuxtContributionDescriptor[]
}

interface ResolvedContributionPage {
  readonly moduleId: string
  readonly page: PlatformNuxtContributionDescriptor['pages'][number]
  readonly file: string
}

interface ResolvedPage {
  readonly page: NuxtPage
  readonly fullPath: string
}

const platformNuxtModule: NuxtModule<PlatformNuxtModuleOptions> =
  defineNuxtModule<PlatformNuxtModuleOptions>({
    meta: {
      name: '@eve-space/platform-module-nuxt',
      compatibility: {
        nuxt: '>=4.5.2 <5',
      },
    },
    moduleDependencies: {
      '@pinia/nuxt': {
        version: '>=1.0.2 <2',
      },
      '@pinia/colada-nuxt': {
        version: '>=1.0.2 <2',
      },
    },
    defaults: {
      contributions: [],
    },
    async setup(options, nuxt) {
      const resolver = createResolver(import.meta.url)
      const contributions = [...(options.contributions ?? [])].toSorted((left, right) =>
        compareStable(left.moduleId, right.moduleId),
      )
      const navigation = [
        ...platformCoreNavigation.map((entry) => ({
          ownerId: entry.ownerId,
          navigationId: entry.navigationId,
          label: entry.label,
          description: entry.description,
          to: entry.path,
          icon: entry.icon,
          audience: entry.audience,
          placement: entry.placement,
          order: entry.order,
        })),
        ...contributions.flatMap((contribution) =>
          contribution.navigation.map((entry) => ({
            ownerId: contribution.moduleId,
            navigationId: entry.id,
            label: entry.label,
            description: entry.description,
            to: entry.to,
            icon: entry.icon ?? contribution.defaultIcon,
            audience: entry.audience,
            placement: entry.placement,
            order: entry.order,
          })),
        ),
      ].toSorted(compareNavigation)
      const pages = contributions
        .flatMap((contribution) =>
          contribution.pages.map((page) => ({
            moduleId: contribution.moduleId,
            pageName: page.name,
            audience: page.audience,
          })),
        )
        .toSorted(
          (left, right) =>
            compareStable(left.moduleId, right.moduleId) ||
            compareStable(left.pageName, right.pageName),
        )
      addTemplate({
        filename: 'eve-space-platform/navigation.ts',
        getContents: () =>
          `export const platformNavigation = ${JSON.stringify(navigation)}\n\nexport const platformPageMetadata = ${JSON.stringify(pages)}\n`,
      })
      addTypeTemplate({
        filename: 'types/eve-space-platform-page-meta.d.ts',
        getContents: () => pageMetaTypes,
      })
      addImports([
        {
          name: 'usePlatformModuleRuntime',
          from: resolver.resolve('./runtime/app/composables/usePlatformModuleRuntime'),
        },
        {
          name: 'usePlatformNavigation',
          from: resolver.resolve('./runtime/app/composables/usePlatformNavigation'),
        },
      ])
      addRouteMiddleware({
        name: 'eve-space-platform-module-enablement',
        path: resolver.resolve('./runtime/app/middleware/platform-module-enablement.global'),
        global: true,
      })
      const contributionPages = await resolveContributionPages(contributions)
      const packageRoots = new Map(
        await Promise.all(
          contributions.map(
            async (contribution) =>
              [contribution.moduleId, await resolveNuxtPackageRoot(contribution.moduleId)] as const,
          ),
        ),
      )
      nuxt.hook('pages:extend', (registeredPages) => {
        const pageNames = new Set(
          flattenPages(registeredPages).flatMap(({ page }) => (page.name ? [page.name] : [])),
        )
        const pagePaths = new Set(flattenPages(registeredPages).map(({ fullPath }) => fullPath))

        for (const contribution of contributionPages) {
          const canonicalPath = canonicalizePath(contribution.page.path)
          if (pageNames.has(contribution.page.name))
            throw new Error(`Nuxt page name ${contribution.page.name} is already registered`)
          if (pagePaths.has(canonicalPath))
            throw new Error(`Nuxt page path ${contribution.page.path} is already registered`)

          const page: NuxtPage = {
            name: contribution.page.name,
            path: contribution.page.path,
            file: contribution.file,
            meta: {
              platformModuleId: contribution.moduleId,
              platformAudience: contribution.page.audience,
            },
          }
          if (contribution.page.extensionPoint === 'character-shell') {
            const parent = resolveCharacterShell(registeredPages)
            page.path = relativeChildPath(parent.path, contribution.page.path)
            parent.children ??= []
            parent.children.push(page)
          } else {
            registeredPages.push(page)
          }

          pageNames.add(contribution.page.name)
          pagePaths.add(canonicalPath)
        }
      })
      nuxt.hook('components:extend', (components) => {
        validateResolvedExposures(
          contributions,
          packageRoots,
          components.map((component) => ({
            name: component.pascalName,
            from: component.filePath,
          })),
          'components',
        )
      })
      nuxt.hook('imports:extend', (imports) => {
        validateResolvedExposures(
          contributions,
          packageRoots,
          imports.map((entry) => ({ name: entry.as ?? entry.name, from: entry.from })),
          'composables',
        )
      })
    },
  })

export default platformNuxtModule

const pageMetaTypes = `import type { PlatformNavigationAudience } from '@eve-space/platform-module-contract'

declare module '@nuxt/schema' {
  interface NuxtPageMeta {
    platformModuleId?: string
    platformAudience?: PlatformNavigationAudience
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    platformModuleId?: string
    platformAudience?: PlatformNavigationAudience
  }
}

export {}
`

function compareNavigation(
  left: {
    placement: string
    order: number
    ownerId: string
    navigationId: string
  },
  right: {
    placement: string
    order: number
    ownerId: string
    navigationId: string
  },
) {
  return (
    compareStable(left.placement, right.placement) ||
    left.order - right.order ||
    compareStable(left.ownerId, right.ownerId) ||
    compareStable(left.navigationId, right.navigationId)
  )
}

function compareStable(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

async function resolveContributionPages(
  contributions: readonly PlatformNuxtContributionDescriptor[],
): Promise<readonly ResolvedContributionPage[]> {
  return Promise.all(
    contributions.flatMap((contribution) =>
      contribution.pages.map(async (page) => {
        const packageRoot = await resolveNuxtPackageRoot(contribution.moduleId)
        const pagesRoot = resolve(packageRoot, 'src/runtime/app/pages')
        const file = resolve(packageRoot, page.file)
        if (relative(pagesRoot, file).startsWith('..'))
          throw new Error(
            `Nuxt page ${contribution.moduleId}/${page.id} must remain under src/runtime/app/pages`,
          )
        if (!existsSync(file))
          throw new Error(`Nuxt page ${contribution.moduleId}/${page.id} is missing ${page.file}`)
        return { moduleId: contribution.moduleId, page, file }
      }),
    ),
  )
}

async function resolveNuxtPackageRoot(moduleId: string) {
  const entrypoint = await resolvePath(`@eve-space/${moduleId}-nuxt`)
  return resolve(dirname(entrypoint), '..')
}

function validateResolvedExposures(
  contributions: readonly PlatformNuxtContributionDescriptor[],
  packageRoots: ReadonlyMap<string, string>,
  registrations: readonly { name: string; from: string }[],
  category: 'components' | 'composables',
) {
  for (const contribution of contributions) {
    const packageRoot = packageRoots.get(contribution.moduleId)
    if (!packageRoot) throw new Error(`Nuxt package ${contribution.moduleId} could not be resolved`)
    for (const name of contribution.exposed?.[category] ?? []) {
      const matches = registrations.filter(
        (registration) => registration.name === name && registration.from.startsWith(packageRoot),
      )
      if (matches.length !== 1)
        throw new Error(
          `Nuxt ${category.slice(0, -1)} ${name} from ${contribution.moduleId} must resolve exactly once`,
        )
    }
  }
}

function flattenPages(pages: readonly NuxtPage[], parentPath = ''): readonly ResolvedPage[] {
  return pages.flatMap((page) => {
    const fullPath = resolveRoutePath(parentPath, page.path)
    return [{ page, fullPath }, ...flattenPages(page.children ?? [], fullPath)]
  })
}

function resolveCharacterShell(pages: readonly NuxtPage[]) {
  const matches = flattenPages(pages).filter(
    ({ fullPath }) => canonicalizePath(fullPath) === '/characters/:parameter',
  )
  if (matches.length !== 1)
    throw new Error(`Expected one character-shell page, found ${matches.length}`)
  return matches[0]!.page
}

function relativeChildPath(parentPath: string, path: string) {
  const parentSegments = canonicalizePath(parentPath).split('/').filter(Boolean)
  const childSegments = canonicalizePath(path).split('/').filter(Boolean)
  if (
    childSegments.length <= parentSegments.length ||
    parentSegments.some((segment, index) => segment !== childSegments[index])
  )
    throw new Error(`Character-shell page ${path} must extend ${parentPath}`)
  return path.split('/').filter(Boolean).slice(parentSegments.length).join('/')
}

function resolveRoutePath(parentPath: string, path: string | undefined) {
  if (!path) return parentPath || '/'
  if (path.startsWith('/')) return canonicalizePath(path)
  return canonicalizePath(`${parentPath.replace(/\/$/, '')}/${path}`)
}

function canonicalizePath(path: string) {
  return path.replace(/:[^/]+/g, ':parameter').replace(/\/$/, '') || '/'
}
