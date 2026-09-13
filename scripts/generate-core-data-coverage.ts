import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { coreDataCoverageManifest } from '../api/src/core-data/coverage-manifest.js'
import { renderCoreDataCoverageReport } from '../api/src/core-data/coverage-report.js'

const reportPath = resolve('docs/core-eve-data-coverage.md')
const expected = renderCoreDataCoverageReport(coreDataCoverageManifest)
const mode = process.argv[2]

if (mode === '--write') await writeFile(reportPath, expected)
else if (mode === '--check') {
  const actual = await readFile(reportPath, 'utf8')
  if (actual !== expected) throw new Error('Core EVE data coverage report is stale')
} else throw new Error('Usage: generate-core-data-coverage.ts --write|--check')
