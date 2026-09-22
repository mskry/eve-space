import { fileURLToPath } from 'node:url'
import { changedRepositoryFiles } from './jev/changed-files.js'
import { createJevClient } from './jev/client.js'
import { runJevReview } from './jev/review.js'
import { collectPlatformContractEvidence } from './platform-contract-review/evidence.js'
import { classifyPlatformContract } from './platform-contract-review/findings.js'
import { judgePlatformContract } from './platform-contract-review/judgments.js'

const repository = new URL('../', import.meta.url)
const root = fileURLToPath(repository)
const base = process.argv[2] ?? 'origin/main'
const client = createJevClient()

const changedFiles = await changedRepositoryFiles(root, base)
const states = await collectPlatformContractEvidence(repository, root, changedFiles)
const review = await runJevReview({
  findingName: 'platform contract',
  reviewedName: 'route contract(s)',
  states,
  judge: (state) => judgePlatformContract(client, state),
  classify: classifyPlatformContract,
})

process.stdout.write(`${review.output}\n`)
if (review.failed) process.exitCode = 1
