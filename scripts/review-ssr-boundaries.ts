import { fileURLToPath } from 'node:url'
import { classifySite, formatReport, type Finding } from './ssr-boundary-review/findings.js'
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
const apiKey = process.env.TYPESAFE_API_KEY

if (!apiKey) throw new Error('TYPESAFE_API_KEY is required to run the SSR boundary review.')

const table = await loadRootMountTable(repository)
const sites = await collectRequestSites(repository, await changedFrontendFiles(root, base))
const states = await Promise.all(sites.map(toSiteState))
const findings: readonly Finding[] = await Promise.all(
  states.map(async (state) => classifySite(state, await judgeSite(apiKey, state))),
)

process.stdout.write(`${formatReport(findings)}\n`)

if (findings.some((finding) => finding.verdict === 'report')) process.exitCode = 1

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
    site,
    rootMiddleware: applicableRouteMiddleware(resolved?.middleware ?? [], route),
    route,
  }
}
