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
}

interface ManagedCorporationEvidence {
  freshness: AccountEvidenceFreshness
  evidenceAt: Date | null
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
      establishedCompliantAt: input.previous?.establishedCompliantAt ?? null,
      issues: [issue('account:no-characters', 'no-attached-characters')],
    }

  const evidenceIssues: AccountComplianceIssue[] = []
  const staleEvidenceTimes: Date[] = []
  for (const character of input.characters) {
    if (character.affiliationResolutionState !== 'resolved' || !character.affiliationCheckedAt) {
      evidenceIssues.push(
        issue(
          `character:${character.characterId}:affiliation-unavailable`,
          'character-affiliation-unavailable',
          character.characterId,
        ),
      )
      if (character.affiliationCheckedAt) staleEvidenceTimes.push(character.affiliationCheckedAt)
    } else if (
      !character.nextAffiliationCheck ||
      character.nextAffiliationCheck.getTime() <= input.now.getTime()
    ) {
      evidenceIssues.push(
        issue(
          `character:${character.characterId}:affiliation-stale`,
          'character-affiliation-stale',
          character.characterId,
        ),
      )
      staleEvidenceTimes.push(character.affiliationCheckedAt)
    }
  }
  if (input.managedCorporationEvidence.freshness !== 'fresh') {
    evidenceIssues.push(
      issue('account:managed-corporations-stale', 'managed-corporation-evidence-unavailable'),
    )
    if (input.managedCorporationEvidence.evidenceAt)
      staleEvidenceTimes.push(input.managedCorporationEvidence.evidenceAt)
  }
  if (evidenceIssues.length > 0)
    return evaluateIncompleteEvidence(input, evidenceIssues, oldestDate(staleEvidenceTimes))

  const evidenceAt = new Date(
    Math.min(
      ...input.characters.map((character) => character.affiliationCheckedAt!.getTime()),
      ...(input.managedCorporationEvidence.evidenceAt
        ? [input.managedCorporationEvidence.evidenceAt.getTime()]
        : []),
    ),
  )
  const issues: AccountComplianceIssue[] = []
  let hasManagedCharacter = false

  for (const character of input.characters) {
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
  if (!hasManagedCharacter)
    issues.push(issue('account:no-managed-character', 'no-managed-organization-character'))
  issues.sort((left, right) => left.issueKey.localeCompare(right.issueKey))

  if (issues.length === 0)
    return {
      state: 'compliant',
      evidenceFreshness: 'fresh',
      evidenceAt,
      reviewDeadline: null,
      establishedCompliantAt: input.previous?.establishedCompliantAt ?? input.now,
      issues,
    }

  const reviewDeadline = earliestReviewDeadline(
    issues,
    input.previous?.issueFirstObservedAt,
    input.strictRemediationDurationSeconds,
    input.now,
  )
  return {
    state: reviewDeadline > input.now ? 'review_required' : 'suspended',
    evidenceFreshness: 'fresh',
    evidenceAt,
    reviewDeadline,
    establishedCompliantAt: input.previous?.establishedCompliantAt ?? null,
    issues,
  }
}

function evaluateIncompleteEvidence(
  input: Parameters<typeof evaluateAccountCompliance>[0],
  issues: readonly AccountComplianceIssue[],
  staleEvidenceAt: Date | null,
): AccountComplianceEvaluation {
  const previous = input.previous
  if (
    previous?.establishedCompliantAt &&
    previous.evidenceAt &&
    input.now.getTime() <=
      previous.evidenceAt.getTime() + input.staleEvidenceGraceDurationSeconds * 1_000
  )
    return {
      state: previous.state,
      evidenceFreshness: 'stale',
      evidenceAt: previous.evidenceAt,
      reviewDeadline: previous.reviewDeadline,
      establishedCompliantAt: previous.establishedCompliantAt,
      issues: previous.issues,
    }

  return {
    state: previous?.establishedCompliantAt ? 'suspended' : 'pending',
    evidenceFreshness:
      staleEvidenceAt && !previous?.establishedCompliantAt ? 'stale' : 'unavailable',
    evidenceAt: staleEvidenceAt && !previous?.establishedCompliantAt ? staleEvidenceAt : null,
    reviewDeadline: null,
    establishedCompliantAt: previous?.establishedCompliantAt ?? null,
    issues: issues.toSorted((left, right) => left.issueKey.localeCompare(right.issueKey)),
  }
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
