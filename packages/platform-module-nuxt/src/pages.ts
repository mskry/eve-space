import type { NuxtPage } from '@nuxt/schema'
import type { PlatformNuxtContributionDescriptor } from '@eve-space/platform-module-contract'

export interface ResolvedContributionPage {
  readonly moduleId: string
  readonly page: PlatformNuxtContributionDescriptor['pages'][number]
  readonly file: string
}

interface ResolvedPage {
  readonly page: NuxtPage
  readonly fullPath: string
}

export function composePlatformPages(
  registeredPages: NuxtPage[],
  contributionPages: readonly ResolvedContributionPage[],
) {
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
