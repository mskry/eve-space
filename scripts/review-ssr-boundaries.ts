import { fileURLToPath } from 'node:url'
import { createJevClient } from './jev/client.js'
import { runJevReview } from './jev/review.js'
import { classifySite } from './ssr-boundary-review/findings.js'
import { judgeSite, type SiteState } from './ssr-boundary-review/judgments.js'
import {
  changedFrontendFiles,
  collectRequestSites,
  type RequestSite,
} from './ssr-boundary-review/request-sites.js'
import {
  applicableRouteMiddleware,
  findRouteDefinition,
} from './ssr-boundary-review/route-definitions.js'
import { loadRootMountTable, resolveMount } from './ssr-boundary-review/route-mounts.js'

const repository = new URL('../', import.meta.url)
const root = fileURLToPath(repository)
const base = process.argv[2] ?? 'origin/main'
const client = createJevClient()

const table = await loadRootMountTable(repository)
const sites = await collectRequestSites(repository, await changedFrontendFiles(root, base))
const states = await Promise.all(sites.map(toSiteState))
const review = await runJevReview({
  classify: classifySite,
  findingName: 'SSR boundary',
  judge: (state) => judgeSite(client, state),
  reviewedName: 'request site(s)',
  states,
})

process.stdout.write(`${review.output}\n`)
if (review.failed) {
  process.exitCode = 1
}

async function toSiteState(site: RequestSite): Promise<SiteState> {
  const resolved = site.requestPath ? resolveMount(site.requestPath, table) : null
  const route =
    resolved && resolved.mounts.length > 0
      ? await findRouteDefinition(
          repository,
          resolved.mounts.map((mount) => mount.source),
          resolved.remainder,
          site.method,
        )
      : null

  return {
    rootMiddleware: applicableRouteMiddleware(resolved?.middleware ?? [], route),
    route,
    site,
  }
}
