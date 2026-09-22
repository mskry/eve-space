export type JevReviewVerdict = 'report' | 'review' | 'pass'

export interface JevReviewFinding {
  readonly verdict: JevReviewVerdict
  readonly location: string
  readonly details?: readonly string[]
  readonly reason: string
}

export interface JevReviewDefinition<State, Judgment, Finding extends JevReviewFinding> {
  readonly findingName: string
  readonly reviewedName: string
  readonly states: readonly State[]
  readonly judge: (state: State) => Promise<Judgment>
  readonly classify: (state: State, judgment: Judgment) => Finding
  readonly concurrency?: number
}

export interface JevReviewResult<Finding extends JevReviewFinding> {
  readonly findings: readonly Finding[]
  readonly output: string
  readonly failed: boolean
}

export async function runJevReview<State, Judgment, Finding extends JevReviewFinding>(
  definition: JevReviewDefinition<State, Judgment, Finding>,
): Promise<JevReviewResult<Finding>> {
  const concurrency = definition.concurrency ?? 4
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error('Jev review concurrency must be a positive integer')
  const findings = await mapConcurrent(definition.states, concurrency, async (state) =>
    definition.classify(state, await definition.judge(state)),
  )
  return {
    findings,
    output: formatJevReview(
      definition.findingName,
      definition.reviewedName,
      definition.states.length,
      findings,
    ),
    failed: findings.some((finding) => finding.verdict === 'report'),
  }
}

function formatJevReview(
  findingName: string,
  reviewedName: string,
  reviewedCount: number,
  findings: readonly JevReviewFinding[],
) {
  const reportable = findings.filter((finding) => finding.verdict !== 'pass')
  if (reportable.length === 0)
    return `No ${findingName} findings across ${reviewedCount} reviewed ${reviewedName}.`

  return reportable.map(formatFinding).join('\n\n')
}

function formatFinding(finding: JevReviewFinding) {
  const details = finding.details?.map((detail) => `  ${detail}`) ?? []
  return [
    `[${finding.verdict.toUpperCase()}] ${finding.location}`,
    ...details,
    `  ${finding.reason}`,
  ].join('\n')
}

async function mapConcurrent<Value, Result>(
  values: readonly Value[],
  concurrency: number,
  operation: (value: Value) => Promise<Result>,
) {
  const results: Result[] = []
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    const index = nextIndex
    nextIndex += 1
    if (index >= values.length) return
    results[index] = await operation(values[index]!)
    await worker()
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}
