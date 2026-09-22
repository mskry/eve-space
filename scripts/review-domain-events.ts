import { fileURLToPath } from 'node:url'
import { collectDomainEventEvidence } from './domain-event-review/evidence.js'
import { classifyDomainEvent } from './domain-event-review/findings.js'
import { judgeDomainEvent } from './domain-event-review/judgments.js'
import { changedRepositoryFiles } from './jev/changed-files.js'
import { createJevClient } from './jev/client.js'
import { runJevReview } from './jev/review.js'

const repository = new URL('../', import.meta.url)
const root = fileURLToPath(repository)
const base = process.argv[2] ?? 'origin/main'
const client = createJevClient()

const changedFiles = await changedRepositoryFiles(root, base)
const states = await collectDomainEventEvidence(root, changedFiles)
const review = await runJevReview({
  findingName: 'domain-event semantic',
  reviewedName: 'producer(s)',
  states,
  judge: (state) => judgeDomainEvent(client, state),
  classify: classifyDomainEvent,
})

process.stdout.write(`${review.output}\n`)
if (review.failed) process.exitCode = 1
