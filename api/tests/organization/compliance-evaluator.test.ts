import { describe, expect, test } from 'vitest'
import {
  evaluateAccountCompliance,
  type AccountComplianceEvaluation,
} from '../../src/organization/compliance-evaluator.js'

const now = new Date('2026-09-01T12:00:00.000Z')
const checkedAt = new Date('2026-09-01T11:55:00.000Z')

describe('organization account compliance evaluation', () => {
  test('requires one managed character and every disclosed character to satisfy policy', () => {
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [
        character({ characterId: 1, corporationId: 98000001 }),
        character({ characterId: 2, corporationId: 98000002, scopes: [] }),
      ],
      requiredScopes: ['esi-skills.read_skills.v1'],
    })

    expect(result).toMatchObject({
      state: 'suspended',
      evidenceFreshness: 'fresh',
      reviewDeadline: now,
      issues: [
        {
          issueKey: 'character:2:external',
          issueCode: 'character-outside-managed-organization',
          characterId: 2,
        },
        {
          issueKey: 'character:2:scope:esi-skills.read_skills.v1',
          issueCode: 'required-scope-missing',
          characterId: 2,
          requiredScope: 'esi-skills.read_skills.v1',
        },
      ],
    })
  })

  test('allows an active exception for an external character but still requires a managed character', () => {
    const exceptionExpiresAt = new Date('2026-09-01T12:05:00.000Z')
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [
        character({ characterId: 1, corporationId: 98000001 }),
        character({
          characterId: 2,
          corporationId: 98000002,
          hasActiveException: true,
          activeExceptionExpiresAt: exceptionExpiresAt,
        }),
      ],
    })

    expect(result).toMatchObject({
      state: 'compliant',
      evidenceFreshness: 'fresh',
      issues: [],
      establishedCompliantAt: now,
      accessValidUntil: exceptionExpiresAt,
    })
    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        characters: [
          character({ characterId: 2, corporationId: 98000002, hasActiveException: true }),
        ],
      }),
    ).toMatchObject({
      state: 'suspended',
      issues: [{ issueCode: 'no-managed-organization-character' }],
    })
  })

  test('uses the first issue observation to preserve a nonzero remediation deadline', () => {
    const firstObservedAt = new Date('2026-09-01T11:30:00.000Z')
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [character({ corporationId: 98000002 })],
      strictRemediationDurationSeconds: 3600,
      previous: previousCompliance({
        issueFirstObservedAt: new Map([['character:1:external', firstObservedAt]]),
      }),
    })

    expect(result.state).toBe('review_required')
    expect(result.reviewDeadline).toEqual(new Date('2026-09-01T12:30:00.000Z'))
    expect(result.accessValidUntil).toBeNull()
  })

  test('retains established entitlements until a nonzero remediation deadline', () => {
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [character({ corporationId: 98000002 })],
      strictRemediationDurationSeconds: 3600,
      previous: previousCompliance({
        state: 'compliant',
        establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
        issues: [],
        issueFirstObservedAt: new Map(),
      }),
    })

    expect(result).toMatchObject({
      state: 'review_required',
      reviewDeadline: new Date('2026-09-01T13:00:00.000Z'),
      accessValidUntil: new Date('2026-09-01T13:00:00.000Z'),
    })
  })

  test('uses the tighter stale-grace boundary while an established account is in review', () => {
    const reviewDeadline = new Date('2026-09-01T13:00:00.000Z')
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [
        character({
          affiliationCheckedAt: new Date('2026-09-01T11:45:00.000Z'),
          affiliationResolutionState: 'pending',
        }),
      ],
      previous: previousCompliance({
        state: 'review_required',
        establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
        reviewDeadline,
        accessValidUntil: reviewDeadline,
      }),
    })

    expect(result).toMatchObject({
      state: 'review_required',
      evidenceFreshness: 'stale',
      reviewDeadline,
      accessValidUntil: new Date('2026-09-01T12:45:00.000Z'),
    })
  })

  test('clears a first-time review deadline when incomplete evidence returns the account to pending', () => {
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [
        character({
          affiliationCheckedAt: new Date('2026-09-01T11:45:00.000Z'),
          affiliationResolutionState: 'pending',
        }),
      ],
      strictRemediationDurationSeconds: 3600,
      previous: previousCompliance({
        state: 'review_required',
        reviewDeadline: new Date('2026-09-01T13:00:00.000Z'),
        accessValidUntil: null,
        establishedCompliantAt: null,
      }),
    })

    expect(result).toMatchObject({ state: 'pending', reviewDeadline: null, accessValidUntil: null })
  })

  test('retains established compliance as stale only inside the bounded grace period', () => {
    const previous = previousCompliance({
      state: 'compliant',
      evidenceAt: new Date('2026-09-01T11:30:00.000Z'),
      establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
      issues: [],
    })
    const unavailableCharacter = character({
      affiliationCheckedAt: new Date('2026-09-01T11:45:00.000Z'),
      nextAffiliationCheck: new Date('2026-09-01T11:45:00.000Z'),
      affiliationResolutionState: 'pending',
    })

    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        characters: [unavailableCharacter],
        previous,
      }),
    ).toMatchObject({
      state: 'compliant',
      evidenceFreshness: 'stale',
      accessValidUntil: new Date('2026-09-01T12:45:00.000Z'),
    })
    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        now: new Date('2026-09-01T13:00:00.000Z'),
        characters: [unavailableCharacter],
        previous,
      }),
    ).toMatchObject({
      state: 'suspended',
      evidenceFreshness: 'unavailable',
      issues: [{ issueCode: 'character-affiliation-unavailable' }],
    })
  })

  test('does not let unrelated stale affiliation hide a fresh missing-scope violation', () => {
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [
        character({ scopes: [] }),
        character({
          characterId: 2,
          affiliationCheckedAt: checkedAt,
          nextAffiliationCheck: new Date('2026-09-01T11:45:00.000Z'),
        }),
      ],
      requiredScopes: ['esi-skills.read_skills.v1'],
      previous: previousCompliance({
        state: 'compliant',
        establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
        issues: [],
      }),
    })

    expect(result).toMatchObject({
      state: 'suspended',
      evidenceFreshness: 'stale',
      accessValidUntil: null,
    })
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issueCode: 'required-scope-missing', characterId: 1 }),
        expect.objectContaining({ issueCode: 'character-affiliation-stale', characterId: 2 }),
      ]),
    )
  })

  test('preserves a strict violation age across stale evidence and recovery', () => {
    const firstObservedAt = new Date('2026-09-01T10:00:00.000Z')
    const stalePrevious = previousCompliance({
      state: 'suspended',
      establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
      reviewDeadline: new Date('2026-09-01T11:00:00.000Z'),
      issueFirstObservedAt: new Map([['character:1:external', firstObservedAt]]),
    })
    const stale = evaluateAccountCompliance({
      ...baseInput(),
      now: new Date('2026-09-01T14:00:00.000Z'),
      characters: [
        character({
          corporationId: 98000002,
          nextAffiliationCheck: new Date('2026-09-01T11:45:00.000Z'),
        }),
      ],
      previous: stalePrevious,
    })
    expect(stale.state).toBe('suspended')
    expect(stale.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ issueKey: 'character:1:external' })]),
    )

    const recovered = evaluateAccountCompliance({
      ...baseInput(),
      characters: [character({ corporationId: 98000002 })],
      strictRemediationDurationSeconds: 3600,
      previous: { ...stalePrevious, issues: stale.issues },
    })
    expect(recovered).toMatchObject({
      state: 'suspended',
      reviewDeadline: new Date('2026-09-01T11:00:00.000Z'),
    })
  })

  test('keeps first-time accounts pending when current evidence is unavailable', () => {
    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        characters: [
          character({ affiliationCheckedAt: null, affiliationResolutionState: 'pending' }),
        ],
      }),
    ).toMatchObject({ state: 'pending', evidenceFreshness: 'unavailable' })
    expect(evaluateAccountCompliance({ ...baseInput(), characters: [] })).toMatchObject({
      state: 'pending',
      issues: [{ issueCode: 'no-attached-characters' }],
    })
  })

  test('does not establish membership from expired affiliation or managed-set evidence', () => {
    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        characters: [character({ nextAffiliationCheck: now })],
      }),
    ).toMatchObject({
      state: 'pending',
      evidenceFreshness: 'stale',
      issues: [{ issueCode: 'character-affiliation-stale' }],
    })
    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        managedCorporationEvidence: {
          freshness: 'stale',
          evidenceAt: checkedAt,
          freshUntil: null,
          staleSince: now,
        },
      }),
    ).toMatchObject({
      state: 'pending',
      evidenceFreshness: 'stale',
      issues: [{ issueCode: 'managed-corporation-evidence-unavailable' }],
    })
  })
})

function baseInput() {
  return {
    characters: [character()],
    managedCorporationIds: new Set([98000001]),
    managedCorporationEvidence: {
      freshness: 'fresh' as const,
      evidenceAt: null,
      freshUntil: null,
      staleSince: null,
    },
    requiredScopes: [] as string[],
    strictRemediationDurationSeconds: 0,
    staleEvidenceGraceDurationSeconds: 3600,
    previous: null,
    now,
  }
}

function character(overrides: Partial<ReturnType<typeof characterDefaults>> = {}) {
  return { ...characterDefaults(), ...overrides }
}

function characterDefaults() {
  return {
    characterId: 1,
    corporationId: 98000001,
    affiliationCheckedAt: checkedAt as Date | null,
    nextAffiliationCheck: new Date('2026-09-01T12:15:00.000Z') as Date | null,
    affiliationResolutionState: 'resolved' as 'pending' | 'resolved' | 'unresolvable',
    scopes: ['esi-skills.read_skills.v1'] as string[],
    hasActiveException: false,
    activeExceptionExpiresAt: null as Date | null,
  }
}

function previousCompliance(
  overrides: Partial<
    AccountComplianceEvaluation & { issueFirstObservedAt: ReadonlyMap<string, Date> }
  > = {},
) {
  return {
    state: 'review_required' as const,
    evidenceFreshness: 'fresh' as const,
    evidenceAt: checkedAt,
    reviewDeadline: null,
    accessValidUntil: null,
    establishedCompliantAt: null,
    issues: [
      {
        issueKey: 'character:1:external',
        issueCode: 'character-outside-managed-organization',
        characterId: 1,
        requiredScope: null,
      },
    ],
    issueFirstObservedAt: new Map<string, Date>(),
    ...overrides,
  }
}
