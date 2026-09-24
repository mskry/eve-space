import { describe, expect, test } from 'vitest'
import {
  evaluateAccountCompliance,
  type AccountComplianceEvaluation,
} from '../../src/organization/compliance-evaluator.js'

const now = new Date('2026-09-01T12:00:00.000Z')
const checkedAt = new Date('2026-09-01T11:55:00.000Z')

describe('organization account compliance evaluation', () => {
  test('requires every disclosed character to retain an authorization record', () => {
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [character({ hasAuthorization: false, scopes: [] })],
    })

    expect(result).toMatchObject({
      accessValidUntil: null,
      evidenceFreshness: 'fresh',
      issues: [
        {
          issueKey: 'character:1:authorization-missing',
          issueCode: 'character-authorization-missing',
          characterId: 1,
          requiredScope: null,
        },
      ],
      state: 'suspended',
    })
  })

  test('requires one managed character and every disclosed character to satisfy policy', () => {
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [
        character({ characterId: 1, corporationId: 98_000_001 }),
        character({ characterId: 2, corporationId: 98_000_002, scopes: [] }),
      ],
      requiredScopes: ['esi-skills.read_skills.v1'],
    })

    expect(result).toMatchObject({
      evidenceFreshness: 'fresh',
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
      reviewDeadline: now,
      state: 'suspended',
    })
  })

  test('allows an active exception for an external character but still requires a managed character', () => {
    const exceptionExpiresAt = new Date('2026-09-01T12:05:00.000Z')
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [
        character({ characterId: 1, corporationId: 98_000_001 }),
        character({
          activeExceptionExpiresAt: exceptionExpiresAt,
          characterId: 2,
          corporationId: 98_000_002,
          hasActiveException: true,
        }),
      ],
    })

    expect(result).toMatchObject({
      accessValidUntil: exceptionExpiresAt,
      establishedCompliantAt: now,
      evidenceFreshness: 'fresh',
      issues: [],
      state: 'compliant',
    })
    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        characters: [
          character({ characterId: 2, corporationId: 98_000_002, hasActiveException: true }),
        ],
      }),
    ).toMatchObject({
      issues: [{ issueCode: 'no-managed-organization-character' }],
      state: 'suspended',
    })
  })

  test('uses the first issue observation to preserve a nonzero remediation deadline', () => {
    const firstObservedAt = new Date('2026-09-01T11:30:00.000Z')
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [character({ corporationId: 98_000_002 })],
      previous: previousCompliance({
        issueFirstObservedAt: new Map([['character:1:external', firstObservedAt]]),
      }),
      strictRemediationDurationSeconds: 3600,
    })

    expect(result.state).toBe('review_required')
    expect(result.reviewDeadline).toStrictEqual(new Date('2026-09-01T12:30:00.000Z'))
    expect(result.accessValidUntil).toBeNull()
  })

  test('retains established entitlements until a nonzero remediation deadline', () => {
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [character({ corporationId: 98_000_002 })],
      previous: previousCompliance({
        state: 'compliant',
        establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
        issues: [],
        issueFirstObservedAt: new Map(),
      }),
      strictRemediationDurationSeconds: 3600,
    })

    expect(result).toMatchObject({
      accessValidUntil: new Date('2026-09-01T13:00:00.000Z'),
      reviewDeadline: new Date('2026-09-01T13:00:00.000Z'),
      state: 'review_required',
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
        accessValidUntil: reviewDeadline,
        establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
        reviewDeadline,
        state: 'review_required',
      }),
    })

    expect(result).toMatchObject({
      accessValidUntil: new Date('2026-09-01T12:45:00.000Z'),
      evidenceFreshness: 'stale',
      reviewDeadline,
      state: 'review_required',
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
      previous: previousCompliance({
        state: 'review_required',
        reviewDeadline: new Date('2026-09-01T13:00:00.000Z'),
        accessValidUntil: null,
        establishedCompliantAt: null,
      }),
      strictRemediationDurationSeconds: 3600,
    })

    expect(result).toMatchObject({ accessValidUntil: null, reviewDeadline: null, state: 'pending' })
  })

  test('retains established compliance as stale only inside the bounded grace period', () => {
    const previous = previousCompliance({
      establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
      evidenceAt: new Date('2026-09-01T11:30:00.000Z'),
      issues: [],
      state: 'compliant',
    })
    const unavailableCharacter = character({
      affiliationCheckedAt: new Date('2026-09-01T11:45:00.000Z'),
      affiliationResolutionState: 'pending',
      nextAffiliationCheck: new Date('2026-09-01T11:45:00.000Z'),
    })

    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        characters: [unavailableCharacter],
        previous,
      }),
    ).toMatchObject({
      accessValidUntil: new Date('2026-09-01T12:45:00.000Z'),
      evidenceFreshness: 'stale',
      state: 'compliant',
    })
    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        characters: [unavailableCharacter],
        now: new Date('2026-09-01T13:00:00.000Z'),
        previous,
      }),
    ).toMatchObject({
      evidenceFreshness: 'unavailable',
      issues: [{ issueCode: 'character-affiliation-unavailable' }],
      state: 'suspended',
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
      previous: previousCompliance({
        state: 'compliant',
        establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
        issues: [],
      }),
      requiredScopes: ['esi-skills.read_skills.v1'],
    })

    expect(result).toMatchObject({
      accessValidUntil: null,
      evidenceFreshness: 'stale',
      state: 'suspended',
    })
    expect(result.issues).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ characterId: 1, issueCode: 'required-scope-missing' }),
        expect.objectContaining({ characterId: 2, issueCode: 'character-affiliation-stale' }),
      ]),
    )
  })

  test('preserves a strict violation age across stale evidence and recovery', () => {
    const firstObservedAt = new Date('2026-09-01T10:00:00.000Z')
    const stalePrevious = previousCompliance({
      establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
      issueFirstObservedAt: new Map([['character:1:external', firstObservedAt]]),
      reviewDeadline: new Date('2026-09-01T11:00:00.000Z'),
      state: 'suspended',
    })
    const stale = evaluateAccountCompliance({
      ...baseInput(),
      characters: [
        character({
          corporationId: 98_000_002,
          nextAffiliationCheck: new Date('2026-09-01T11:45:00.000Z'),
        }),
      ],
      now: new Date('2026-09-01T14:00:00.000Z'),
      previous: stalePrevious,
    })
    expect(stale.state).toBe('suspended')
    expect(stale.issues).toStrictEqual(
      expect.arrayContaining([expect.objectContaining({ issueKey: 'character:1:external' })]),
    )

    const recovered = evaluateAccountCompliance({
      ...baseInput(),
      characters: [character({ corporationId: 98_000_002 })],
      previous: { ...stalePrevious, issues: stale.issues },
      strictRemediationDurationSeconds: 3600,
    })
    expect(recovered).toMatchObject({
      reviewDeadline: new Date('2026-09-01T11:00:00.000Z'),
      state: 'suspended',
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
    ).toMatchObject({ evidenceFreshness: 'unavailable', state: 'pending' })
    expect(evaluateAccountCompliance({ ...baseInput(), characters: [] })).toMatchObject({
      issues: [{ issueCode: 'no-attached-characters' }],
      state: 'pending',
    })
  })

  test('does not establish membership from expired affiliation or managed-set evidence', () => {
    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        characters: [character({ nextAffiliationCheck: now })],
      }),
    ).toMatchObject({
      evidenceFreshness: 'stale',
      issues: [{ issueCode: 'character-affiliation-stale' }],
      state: 'pending',
    })
    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        managedCorporationEvidence: {
          evidenceAt: checkedAt,
          freshUntil: null,
          freshness: 'stale',
          staleSince: now,
        },
      }),
    ).toMatchObject({
      evidenceFreshness: 'stale',
      issues: [{ issueCode: 'managed-corporation-evidence-unavailable' }],
      state: 'pending',
    })
  })
})

function baseInput() {
  return {
    characters: [character()],
    managedCorporationEvidence: {
      evidenceAt: null,
      freshUntil: null,
      freshness: 'fresh' as const,
      staleSince: null,
    },
    managedCorporationIds: new Set([98_000_001]),
    now,
    previous: null,
    requiredScopes: [] as string[],
    staleEvidenceGraceDurationSeconds: 3600,
    strictRemediationDurationSeconds: 0,
  }
}

function character(overrides: Partial<ReturnType<typeof characterDefaults>> = {}) {
  return { ...characterDefaults(), ...overrides }
}

function characterDefaults() {
  return {
    activeExceptionExpiresAt: null as Date | null,
    affiliationCheckedAt: checkedAt as Date | null,
    affiliationResolutionState: 'resolved' as 'pending' | 'resolved' | 'unresolvable',
    characterId: 1,
    corporationId: 98_000_001,
    hasActiveException: false,
    hasAuthorization: true,
    nextAffiliationCheck: new Date('2026-09-01T12:15:00.000Z') as Date | null,
    scopes: ['esi-skills.read_skills.v1'] as string[],
  }
}

function previousCompliance(
  overrides: Partial<
    AccountComplianceEvaluation & { issueFirstObservedAt: ReadonlyMap<string, Date> }
  > = {},
) {
  return {
    accessValidUntil: null,
    establishedCompliantAt: null,
    evidenceAt: checkedAt,
    evidenceFreshness: 'fresh' as const,
    issueFirstObservedAt: new Map<string, Date>(),
    issues: [
      {
        issueKey: 'character:1:external',
        issueCode: 'character-outside-managed-organization',
        characterId: 1,
        requiredScope: null,
      },
    ],
    reviewDeadline: null,
    state: 'review_required' as const,
    ...overrides,
  }
}
