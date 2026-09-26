import { describe, expect, test } from 'vitest'
import {
  evaluateRuleEligibility,
  isOrganizationRuleRolePredicate,
  isRuleCondition,
  organizationRuleRolePredicates,
  type RuleEvidenceSource,
  type RuleEligibilityInput,
} from '../../src/organization/rule-policy.js'

const now = new Date('2026-09-25T12:00:00Z')
const source = (overrides: Partial<RuleEvidenceSource> = {}): RuleEvidenceSource => ({
  sourceId: 'source-a',
  kind: 'corporation-role',
  predicate: 'accountant',
  binding: {
    subjectLifecycleId: 'lifecycle',
    affiliationPeriodRevision: 'period',
    authorizationGeneration: 1,
    authorityCorporationId: 98_000_001,
    executorRevision: null,
    executorFreshUntil: null,
  },
  complete: true,
  bindingCurrent: true,
  status: 'fresh',
  freshUntil: new Date(now.getTime() + 60_000),
  roleRevision: 'current-revision',
  ...overrides,
})
const input = (overrides: Partial<RuleEligibilityInput> = {}): RuleEligibilityInput => ({
  condition: { kind: 'corporation-role', predicate: 'accountant' },
  admitted: true,
  compliant: true,
  blocked: false,
  sources: [source()],
  now,
  ...overrides,
})

describe('organization automatic-group policy', () => {
  test('accepts only exact reviewed condition shapes', () => {
    expect(isRuleCondition({ kind: 'registration-compliant' })).toBe(true)
    expect(isRuleCondition({ kind: 'director-audience' })).toBe(true)
    expect(isRuleCondition({ kind: 'corporation-role', predicate: 'accountant' })).toBe(true)
    expect(organizationRuleRolePredicates).toStrictEqual([
      'director',
      'accountant',
      'factory-manager',
    ])
    for (const invalid of [
      { kind: 'corporation-role', predicate: 'project-manager' },
      { kind: 'corporation-role', predicate: 'station-manager' },
      { kind: 'corporation-role', predicate: 'Account_Take_1' },
      { kind: 'corporation-role', predicate: 'accountant', location: 'rolesAtBase' },
      { kind: 'director-audience', role: 'Director' },
      { kind: 'module-fact', predicate: 'wallet-balance' },
    ]) {
      expect(isRuleCondition(invalid)).toBe(false)
    }
    expect(isOrganizationRuleRolePredicate('project-manager')).toBe(false)
    expect(isOrganizationRuleRolePredicate('station-manager')).toBe(false)
  })

  test('does not combine incomplete character sources into an account grant', () => {
    expect(
      evaluateRuleEligibility(
        input({
          sources: [
            source({ sourceId: 'scope-only', complete: false }),
            source({ sourceId: 'role-only', complete: false }),
          ],
        }),
      ),
    ).toStrictEqual({ outcome: 'ineligible', contributors: [] })
    expect(
      evaluateRuleEligibility(
        input({
          sources: [
            source({ sourceId: 'scope-only', complete: false }),
            source({ sourceId: 'eligible-alt' }),
          ],
        }),
      ),
    ).toMatchObject({ outcome: 'eligible', contributors: [{ sourceId: 'eligible-alt' }] })
  })

  test('retains independent explicit Director authority when derived evidence is lost', () => {
    const condition = { kind: 'director-audience' } as const
    expect(
      evaluateRuleEligibility(
        input({
          condition,
          sources: [
            source({ kind: 'derived-director', sourceId: 'lost-eve', status: 'invalid' }),
            source({
              kind: 'explicit-director',
              sourceId: 'explicit',
              roleRevision: null,
              binding: null,
            }),
          ],
        }),
      ),
    ).toMatchObject({ outcome: 'eligible', contributors: [{ sourceId: 'explicit' }] })
    expect(
      evaluateRuleEligibility(
        input({
          condition,
          sources: [
            source({ kind: 'corporation-role', predicate: 'director', sourceId: 'owner-only' }),
          ],
        }),
      ),
    ).toStrictEqual({ outcome: 'ineligible', contributors: [] })
  })

  test('fails closed for blocks, mismatched bindings, degradation, and absolute expiry', () => {
    expect(evaluateRuleEligibility(input({ blocked: true })).outcome).toBe('ineligible')
    expect(
      evaluateRuleEligibility(input({ sources: [source({ bindingCurrent: false })] })).outcome,
    ).toBe('ineligible')
    expect(evaluateRuleEligibility(input({ sources: [source({ binding: null })] })).outcome).toBe(
      'ineligible',
    )
    expect(
      evaluateRuleEligibility(input({ sources: [source({ status: 'degraded' })] })).outcome,
    ).toBe('unavailable')
    expect(evaluateRuleEligibility(input({ sources: [source({ freshUntil: now })] })).outcome).toBe(
      'ineligible',
    )
    expect(evaluateRuleEligibility(input({ admitted: false })).outcome).toBe('ineligible')
  })

  test('requires compliant registration evidence for the compliance condition', () => {
    const condition = { kind: 'registration-compliant' } as const
    const registration = source({
      kind: 'registration',
      sourceId: 'member',
      roleRevision: null,
      binding: null,
    })
    expect(evaluateRuleEligibility(input({ condition, sources: [registration] })).outcome).toBe(
      'eligible',
    )
    expect(
      evaluateRuleEligibility(input({ condition, compliant: false, sources: [registration] }))
        .outcome,
    ).toBe('ineligible')
  })
})
