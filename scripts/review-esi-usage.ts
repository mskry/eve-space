import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEsiCatalogReviewSources } from '../api/src/esi-gateway/catalog-authority.js'
import { indexEsiCatalogEvidence } from './esi-usage-review/catalog-evidence.js'
import { classifyEsiUsage } from './esi-usage-review/findings.js'
import { judgeEsiUsage, type EsiUsageState } from './esi-usage-review/judgments.js'
import { collectEsiUsageSites, isEsiUsageSource } from './esi-usage-review/sites.js'
import {
  changedRepositoryFiles,
  mergeBaseRevision,
  repositoryFileAtRevision,
} from './jev/changed-files.js'
import { createJevClient } from './jev/client.js'
import { runJevReview } from './jev/review.js'
import { loadTypescriptSourceDirectory } from './typescript-source-directory.js'

const repository = new URL('../', import.meta.url)
const root = fileURLToPath(repository)
const base = process.argv[2] ?? 'origin/main'
const client = createJevClient()
const catalogReviewSources = getEsiCatalogReviewSources()
const catalogAuthorityFiles = new Set(Object.values(catalogReviewSources))

const changedFiles = await changedRepositoryFiles(root, base)
const previousRevision = await mergeBaseRevision(root, base)
const reviewAllRepresentations = changedFiles.some((file) => catalogAuthorityFiles.has(file))
const files = reviewAllRepresentations
  ? (await loadTypescriptSourceDirectory(root, join(root, 'api', 'src'))).map(({ path }) => path)
  : changedFiles.filter(isEsiUsageSource)
const previousSources = new Map(
  await Promise.all(
    files.map(
      async (file) => [file, await repositoryFileAtRevision(root, previousRevision, file)] as const,
    ),
  ),
)
const sites = await collectEsiUsageSites(repository, files, previousSources)
const evidence = await loadCatalogEvidence()
const states = sites.map((site): EsiUsageState => ({
  catalog: evidence.get(site.operation) ?? emptyCatalogEvidence(),
  site,
}))
const review = await runJevReview({
  classify: classifyEsiUsage,
  findingName: 'ESI usage',
  judge: (state) => judgeEsiUsage(client, state),
  reviewedName: 'representation(s)',
  states,
})

process.stdout.write(`${review.output}\n`)
if (review.failed) {
  process.exitCode = 1
}

async function loadCatalogEvidence() {
  const { catalog: catalogFile, operationMetadata: metadataFile } = catalogReviewSources
  const [catalog, metadata, previousCatalog, previousMetadata] = await Promise.all([
    readFile(new URL(catalogFile, repository), 'utf8'),
    readFile(new URL(metadataFile, repository), 'utf8'),
    repositoryFileAtRevision(root, previousRevision, catalogFile),
    repositoryFileAtRevision(root, previousRevision, metadataFile),
  ])
  return indexEsiCatalogEvidence(catalog, metadata, previousCatalog, previousMetadata)
}

function emptyCatalogEvidence() {
  return {
    cacheKind: 'unknown' as const,
    contract: null,
    metadata: null,
    previousContract: null,
    previousMetadata: null,
  }
}
