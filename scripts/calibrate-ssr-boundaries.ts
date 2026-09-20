import { readdir } from 'node:fs/promises'
import { classifySite } from './ssr-boundary-review/findings.js'
import { judgeSite, type SiteState } from './ssr-boundary-review/judgments.js'
import { loadLabelledRequests } from './ssr-boundary-review/labelled-requests.js'
import { collectRequestSites, type RequestSite } from './ssr-boundary-review/request-sites.js'
import {
  applicableRouteMiddleware,
  findRouteDefinition,
} from './ssr-boundary-review/route-definitions.js'
import { loadRootMountTable, resolveMount } from './ssr-boundary-review/route-mounts.js'

const repository = new URL('../', import.meta.url)
const apiKey = process.env.TYPESAFE_API_KEY

if (!apiKey) throw new Error('TYPESAFE_API_KEY is required to calibrate the SSR boundary review.')

const table = await loadRootMountTable(repository)
const labelled = await loadLabelledRequests(repository)
const sites = await collectRequestSites(repository, await frontendFiles('app'))
const matched = labelled.flatMap((label) => {
  const site = sites.find((candidate) => candidate.definitionSource?.includes(`(${label.name})`))

  return site ? [{ label, site }] : []
})

process.stdout.write(`labelled ${labelled.length}, matched to a call site ${matched.length}\n\n`)

const results = await Promise.all(
  matched.map(async ({ label, site }) => {
    const state = await toSiteState(site)

    const judgment = await judgeSite(apiKey, state)

    return { label, judgment, verdict: classifySite(state, judgment) }
  }),
)

const requirementHits = results.filter(
  (result) => result.judgment.credentialRequirement.choice === result.label.credentialRequirement,
)

process.stdout.write(
  `credential_requirement agreement: ${requirementHits.length}/${results.length}\n`,
)

for (const result of results)
  if (result.judgment.credentialRequirement.choice !== result.label.credentialRequirement)
    process.stdout.write(
      `  ${result.label.name}: model ${result.judgment.credentialRequirement.choice} (${result.judgment.credentialRequirement.confidence.toFixed(2)}) vs labelled ${result.label.credentialRequirement}\n`,
    )

const gated = results.filter((result) => result.label.ssrGated)
const capable = results.filter((result) => !result.label.ssrGated)

process.stdout.write(
  `\nssr_capable on labelled-gated (${gated.length}): ${describe(gated.map((result) => result.judgment.ssrCapable))}\n`,
)
process.stdout.write(
  `ssr_capable on labelled-SSR-capable (${capable.length}): ${describe(capable.map((result) => result.judgment.ssrCapable))}\n`,
)

const safePaths = new Map<string, number>()

for (const result of gated)
  safePaths.set(
    result.judgment.ssrSafePath.choice,
    (safePaths.get(result.judgment.ssrSafePath.choice) ?? 0) + 1,
  )

process.stdout.write(`\nssr_safe_path on labelled-gated (${gated.length}):\n`)

for (const [choice, count] of safePaths) process.stdout.write(`  ${choice}: ${count}\n`)

process.stdout.write(
  `  gate confidence: ${describe(gated.map((result) => result.judgment.ssrSafePath.confidence))}\n`,
)
process.stdout.write(
  `\nwould auto-report (safe_path none): ${gated.filter((result) => result.judgment.ssrSafePath.choice === 'none').length}/${gated.length} false positives\n`,
)

const verdicts = new Map<string, number>()

for (const result of results)
  verdicts.set(result.verdict.verdict, (verdicts.get(result.verdict.verdict) ?? 0) + 1)

process.stdout.write(`\nend-to-end verdicts (every labelled row is a non-violation):\n`)

for (const [verdict, count] of verdicts) process.stdout.write(`  ${verdict}: ${count}\n`)

for (const result of results)
  if (result.verdict.verdict !== 'pass')
    process.stdout.write(
      `  ${result.verdict.verdict.toUpperCase()} ${result.label.name}: safe_path ${result.judgment.ssrSafePath.choice} (${result.judgment.ssrSafePath.confidence.toFixed(2)}), ssr ${result.judgment.ssrCapable.toFixed(2)}\n`,
    )

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

async function frontendFiles(directory: string): Promise<string[]> {
  const entries = await readdir(new URL(`${directory}/`, repository), { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => frontendFiles(`${directory}/${entry.name}`)),
  )

  return [
    ...entries
      .filter((entry) => entry.isFile() && /\.(ts|vue)$/.test(entry.name))
      .map((entry) => `${directory}/${entry.name}`),
    ...nested.flat(),
  ]
}

function describe(values: readonly number[]) {
  if (values.length === 0) return 'none'

  const sorted = [...values].toSorted((left, right) => left - right)
  const mean = values.reduce((total, value) => total + value, 0) / values.length

  return `min ${sorted[0].toFixed(2)} median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)} max ${sorted.at(-1)!.toFixed(2)} mean ${mean.toFixed(2)}`
}
