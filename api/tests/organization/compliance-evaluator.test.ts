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
    const result = evaluateAccountCompliance({
      ...baseInput(),
      characters: [
        character({ characterId: 1, corporationId: 98000001 }),
        character({ characterId: 2, corporationId: 98000002, hasActiveException: true }),
      ],
    })

    expect(result).toMatchObject({
      state: 'compliant',
      evidenceFreshness: 'fresh',
      issues: [],
      establishedCompliantAt: now,
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
  })

  test('retains established compliance as stale only inside the bounded grace period', () => {
    const previous = previousCompliance({
      state: 'compliant',
      evidenceAt: new Date('2026-09-01T11:30:00.000Z'),
      establishedCompliantAt: new Date('2026-08-01T00:00:00.000Z'),
      issues: [],
    })
    const unavailableCharacter = character({
      affiliationCheckedAt: null,
      affiliationResolutionState: 'pending',
    })

    expect(
      evaluateAccountCompliance({
        ...baseInput(),
        characters: [unavailableCharacter],
        previous,
      }),
    ).toMatchObject({ state: 'compliant', evidenceFreshness: 'stale' })
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
        managedCorporationEvidence: { freshness: 'stale', evidenceAt: checkedAt },
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
    managedCorporationEvidence: { freshness: 'fresh' as const, evidenceAt: null },
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
