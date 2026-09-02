type AccountComplianceState = 'pending' | 'compliant' | 'review_required' | 'suspended'
type AccountEvidenceFreshness = 'fresh' | 'stale' | 'unavailable'

export interface AccountComplianceIssue {
  issueKey: string
  issueCode: string
  characterId: number | null
  requiredScope: string | null
}

export interface AccountComplianceEvaluation {
  state: AccountComplianceState
  evidenceFreshness: AccountEvidenceFreshness
  evidenceAt: Date | null
  reviewDeadline: Date | null
  accessValidUntil: Date | null
  establishedCompliantAt: Date | null
  issues: AccountComplianceIssue[]
}

interface ComplianceCharacter {
  characterId: number
  corporationId: number
  affiliationCheckedAt: Date | null
  nextAffiliationCheck: Date | null
  affiliationResolutionState: 'pending' | 'resolved' | 'unresolvable'
  scopes: readonly string[]
  hasActiveException: boolean
  activeExceptionExpiresAt: Date | null
}

interface ManagedCorporationEvidence {
  freshness: AccountEvidenceFreshness
  evidenceAt: Date | null
  freshUntil: Date | null
  staleSince: Date | null
}

interface PreviousCompliance extends AccountComplianceEvaluation {
  issueFirstObservedAt: ReadonlyMap<string, Date>
}

export function evaluateAccountCompliance(input: {
  characters: readonly ComplianceCharacter[]
  managedCorporationIds: ReadonlySet<number>
  managedCorporationEvidence: ManagedCorporationEvidence
  requiredScopes: readonly string[]
  strictRemediationDurationSeconds: number
  staleEvidenceGraceDurationSeconds: number
  previous: PreviousCompliance | null
  now: Date
}): AccountComplianceEvaluation {
  if (input.characters.length === 0)
    return {
      state: 'pending',
      evidenceFreshness: 'unavailable',
      evidenceAt: null,
      reviewDeadline: null,
      accessValidUntil: null,
      establishedCompliantAt: input.previous?.establishedCompliantAt ?? null,
      issues: [issue('account:no-characters', 'no-attached-characters')],
    }

  const evidence = evaluateEvidence(input)
  const policyIssues = evaluatePolicyIssues(input, evidence)

  if (policyIssues.length > 0)
    return evaluatePolicyViolation(input, policyIssues, evidence.issues, evidence.evidenceTimes)

  if (evidence.issues.length > 0)
    return evaluateIncompleteEvidence(
      input,
      evidence.issues,
      oldestDate(evidence.evidenceTimes),
      oldestDate(evidence.staleSinceTimes),
    )

  return {
    state: 'compliant',
    evidenceFreshness: 'fresh',
    evidenceAt: freshEvidenceAt(input),
    reviewDeadline: null,
    accessValidUntil: earliestDate([
      ...input.characters.map((character) => character.nextAffiliationCheck),
      ...input.characters.map((character) =>
        !input.managedCorporationIds.has(character.corporationId) && character.hasActiveException
          ? character.activeExceptionExpiresAt
          : null,
      ),
      input.managedCorporationEvidence.freshUntil,
    ]),
    establishedCompliantAt: input.previous?.establishedCompliantAt ?? input.now,
    issues: [],
  }
}

function evaluateEvidence(input: Parameters<typeof evaluateAccountCompliance>[0]) {
  const issues: AccountComplianceIssue[] = []
  const evidenceTimes: Date[] = []
  const staleSinceTimes: Date[] = []
  const freshAffiliations = new Set<number>()

  for (const character of input.characters) {
    const evidence = evaluateCharacterAffiliation(character, input.now)
    if (!evidence.issue) {
      freshAffiliations.add(character.characterId)
      continue
    }

    issues.push(evidence.issue)
    if (evidence.evidenceAt) evidenceTimes.push(evidence.evidenceAt)
    if (evidence.staleSince) staleSinceTimes.push(evidence.staleSince)
  }

  if (input.managedCorporationEvidence.freshness === 'fresh')
    return { issues, evidenceTimes, staleSinceTimes, freshAffiliations }

  issues.push(
    issue('account:managed-corporations-stale', 'managed-corporation-evidence-unavailable'),
  )
  if (input.managedCorporationEvidence.evidenceAt)
    evidenceTimes.push(input.managedCorporationEvidence.evidenceAt)
  if (input.managedCorporationEvidence.staleSince)
    staleSinceTimes.push(input.managedCorporationEvidence.staleSince)

  return { issues, evidenceTimes, staleSinceTimes, freshAffiliations }
}

function evaluateCharacterAffiliation(character: ComplianceCharacter, now: Date) {
  if (character.affiliationResolutionState !== 'resolved' || !character.affiliationCheckedAt)
    return {
      issue: issue(
        `character:${character.characterId}:affiliation-unavailable`,
        'character-affiliation-unavailable',
        character.characterId,
      ),
      evidenceAt: character.affiliationCheckedAt,
      staleSince: character.affiliationCheckedAt,
    }

  if (!character.nextAffiliationCheck || character.nextAffiliationCheck.getTime() <= now.getTime())
    return {
      issue: issue(
        `character:${character.characterId}:affiliation-stale`,
        'character-affiliation-stale',
        character.characterId,
      ),
      evidenceAt: character.affiliationCheckedAt,
      staleSince: character.nextAffiliationCheck ?? character.affiliationCheckedAt,
    }

  return { issue: null, evidenceAt: null, staleSince: null }
}

function evaluatePolicyIssues(
  input: Parameters<typeof evaluateAccountCompliance>[0],
  evidence: ReturnType<typeof evaluateEvidence>,
) {
  const organizationPolicy = evaluateOrganizationPolicy(input, evidence.freshAffiliations)
  const issues = [...organizationPolicy.issues, ...evaluateRequiredScopePolicy(input)]

  if (evidence.issues.length === 0 && !organizationPolicy.hasManagedCharacter)
    issues.push(issue('account:no-managed-character', 'no-managed-organization-character'))

  return issues
}

function evaluateOrganizationPolicy(
  input: Parameters<typeof evaluateAccountCompliance>[0],
  freshAffiliations: ReadonlySet<number>,
) {
  const issues: AccountComplianceIssue[] = []
  let hasManagedCharacter = false
  if (input.managedCorporationEvidence.freshness !== 'fresh') return { issues, hasManagedCharacter }

  for (const character of input.characters) {
    if (!freshAffiliations.has(character.characterId)) continue

    const managed = input.managedCorporationIds.has(character.corporationId)
    hasManagedCharacter ||= managed
    if (!managed && !character.hasActiveException)
      issues.push(
        issue(
          `character:${character.characterId}:external`,
          'character-outside-managed-organization',
          character.characterId,
        ),
      )
  }

  return { issues, hasManagedCharacter }
}

function evaluateRequiredScopePolicy(input: Parameters<typeof evaluateAccountCompliance>[0]) {
  const issues: AccountComplianceIssue[] = []
  for (const character of input.characters) {
    const scopes = new Set(character.scopes)
    for (const requiredScope of input.requiredScopes)
      if (!scopes.has(requiredScope))
        issues.push(
          issue(
            `character:${character.characterId}:scope:${requiredScope}`,
            'required-scope-missing',
            character.characterId,
            requiredScope,
          ),
        )
  }
  return issues
}

function evaluatePolicyViolation(
  input: Parameters<typeof evaluateAccountCompliance>[0],
  policyIssues: readonly AccountComplianceIssue[],
  evidenceIssues: readonly AccountComplianceIssue[],
  evidenceTimes: readonly Date[],
): AccountComplianceEvaluation {
  const reviewDeadline = earliestReviewDeadline(
    policyIssues,
    input.previous?.issueFirstObservedAt,
    input.strictRemediationDurationSeconds,
    input.now,
  )
  let evidenceFreshness: AccountEvidenceFreshness = 'unavailable'
  if (evidenceIssues.length === 0) evidenceFreshness = 'fresh'
  else if (evidenceTimes.length > 0) evidenceFreshness = 'stale'

  let evidenceAt: Date | null = null
  if (evidenceFreshness === 'fresh') evidenceAt = freshEvidenceAt(input)
  else if (evidenceFreshness === 'stale')
    evidenceAt = oldestDate(evidenceTimes) ?? input.previous?.evidenceAt ?? null

  const state = reviewDeadline > input.now ? 'review_required' : 'suspended'
  return {
    state,
    evidenceFreshness,
    evidenceAt,
    reviewDeadline,
    accessValidUntil:
      state === 'review_required' && input.previous?.establishedCompliantAt ? reviewDeadline : null,
    establishedCompliantAt: input.previous?.establishedCompliantAt ?? null,
    issues: [...policyIssues, ...evidenceIssues].toSorted((left, right) =>
      left.issueKey.localeCompare(right.issueKey),
    ),
  }
}

function freshEvidenceAt(input: Parameters<typeof evaluateAccountCompliance>[0]) {
  return new Date(
    Math.min(
      ...input.characters.map((character) => character.affiliationCheckedAt!.getTime()),
      ...(input.managedCorporationEvidence.evidenceAt
        ? [input.managedCorporationEvidence.evidenceAt.getTime()]
        : []),
    ),
  )
}

function evaluateIncompleteEvidence(
  input: Parameters<typeof evaluateAccountCompliance>[0],
  issues: readonly AccountComplianceIssue[],
  staleEvidenceAt: Date | null,
  staleSince: Date | null,
): AccountComplianceEvaluation {
  const previous = input.previous
  const staleDeadline = staleSince
    ? new Date(staleSince.getTime() + input.staleEvidenceGraceDurationSeconds * 1_000)
    : null
  if (
    previous?.establishedCompliantAt &&
    staleDeadline &&
    input.now.getTime() < staleDeadline.getTime()
  ) {
    const reviewExpired =
      previous.reviewDeadline !== null && previous.reviewDeadline.getTime() <= input.now.getTime()
    return {
      state: reviewExpired ? 'suspended' : previous.state,
      evidenceFreshness: 'stale',
      evidenceAt: previous.evidenceAt ?? staleEvidenceAt,
      reviewDeadline: previous.reviewDeadline,
      accessValidUntil: accessValidUntilDuringStaleGrace(previous, staleDeadline, reviewExpired),
      establishedCompliantAt: previous.establishedCompliantAt,
      issues: previous.issues,
    }
  }

  return {
    state: previous?.establishedCompliantAt ? 'suspended' : 'pending',
    evidenceFreshness:
      staleEvidenceAt && !previous?.establishedCompliantAt ? 'stale' : 'unavailable',
    evidenceAt: staleEvidenceAt && !previous?.establishedCompliantAt ? staleEvidenceAt : null,
    reviewDeadline: previous?.establishedCompliantAt ? previous.reviewDeadline : null,
    accessValidUntil: null,
    establishedCompliantAt: previous?.establishedCompliantAt ?? null,
    issues: mergeIssues(previous?.issues ?? [], issues),
  }
}

function accessValidUntilDuringStaleGrace(
  previous: PreviousCompliance,
  staleDeadline: Date,
  reviewExpired: boolean,
) {
  if (reviewExpired) return null
  if (previous.state === 'compliant') return staleDeadline
  if (previous.state === 'review_required' && previous.accessValidUntil)
    return earliestDate([previous.accessValidUntil, staleDeadline])
  return null
}

function mergeIssues(
  previous: readonly AccountComplianceIssue[],
  current: readonly AccountComplianceIssue[],
) {
  return [
    ...new Map([...previous, ...current].map((entry) => [entry.issueKey, entry])).values(),
  ].toSorted((left, right) => left.issueKey.localeCompare(right.issueKey))
}

function earliestDate(dates: readonly (Date | null)[]) {
  return oldestDate(dates.filter((date): date is Date => date !== null))
}

function oldestDate(dates: readonly Date[]) {
  return dates.length > 0 ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null
}

function earliestReviewDeadline(
  issues: readonly AccountComplianceIssue[],
  firstObservedAt: ReadonlyMap<string, Date> | undefined,
  durationSeconds: number,
  now: Date,
) {
  return new Date(
    Math.min(
      ...issues.map(
        ({ issueKey }) =>
          (firstObservedAt?.get(issueKey) ?? now).getTime() + durationSeconds * 1_000,
      ),
    ),
  )
}

function issue(
  issueKey: string,
  issueCode: string,
  characterId: number | null = null,
  requiredScope: string | null = null,
): AccountComplianceIssue {
  return { issueKey, issueCode, characterId, requiredScope }
}
