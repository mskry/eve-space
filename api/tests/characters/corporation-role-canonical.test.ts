import { describe, expect, test } from 'vitest'
import { platformEsiRolePredicates } from '@eve-space/platform-module-contract/esi'
import {
  canonicalizeCorporationRoleSets,
  classifyCorporationRoleTransition,
  evaluateCorporationRolePredicate,
  isReviewedCorporationRolePredicate,
  evaluateReviewedCorporationRolePredicates,
  resolveCorporationRoleRevision,
  type CorporationRoleSets,
} from '../../src/characters/corporation-role-canonical.js'

const sets = (overrides: Partial<CorporationRoleSets> = {}): CorporationRoleSets => ({
  roles: [],
  rolesAtBase: [],
  rolesAtHeadquarters: [],
  rolesAtOther: [],
  ...overrides,
})

describe('corporation-role canonicalization', () => {
  test('evaluates every reviewed operation predicate through the character-owned evaluator', () => {
    for (const predicate of platformEsiRolePredicates) {
      expect(isReviewedCorporationRolePredicate(predicate)).toBe(true)
    }
    expect(
      evaluateCorporationRolePredicate(sets({ roles: ['Project_Manager'] }), 'project-manager'),
    ).toBe(true)
    expect(
      evaluateCorporationRolePredicate(
        sets({ rolesAtBase: ['Station_Manager'] }),
        'station-manager',
      ),
    ).toBe(false)
  })
  test('sorts by code unit and deduplicates every role location', () => {
    expect(
      canonicalizeCorporationRoleSets({
        roles: ['Director', 'Accountant', 'Director', 'Account_Take_1'],
        rolesAtBase: ['Trader', 'Auditor', 'Trader'],
        rolesAtHeadquarters: ['Station_Manager'],
        rolesAtOther: [],
      }),
    ).toStrictEqual({
      roles: ['Account_Take_1', 'Accountant', 'Director'],
      rolesAtBase: ['Auditor', 'Trader'],
      rolesAtHeadquarters: ['Station_Manager'],
      rolesAtOther: [],
    })
  })

  test('treats reordered memberships as unchanged', () => {
    const previous = canonicalizeCorporationRoleSets(sets({ roles: ['Director', 'Accountant'] }))
    const current = canonicalizeCorporationRoleSets(sets({ roles: ['Accountant', 'Director'] }))

    expect(classifyCorporationRoleTransition(previous, current)).toBe('unchanged')
  })

  test.each([
    [null, sets({ roles: ['Director'] }), 'initial'],
    [sets({ roles: ['Director'] }), sets({ roles: ['Accountant', 'Director'] }), 'gained'],
    [sets({ roles: ['Accountant', 'Director'] }), sets({ roles: ['Director'] }), 'lost'],
    [sets({ rolesAtBase: ['Trader'] }), sets({ rolesAtHeadquarters: ['Trader'] }), 'lost'],
    [sets({ roles: ['Director'], rolesAtOther: ['Trader'] }), sets(), 'lost'],
    [sets(), sets(), 'unchanged'],
  ] as const)('classifies %o to %o as %s', (previous, current, transition) => {
    expect(classifyCorporationRoleTransition(previous, current)).toBe(transition)
  })

  test('evaluates reviewed predicates only from global roles', () => {
    expect(
      evaluateReviewedCorporationRolePredicates(
        sets({
          roles: [
            'Director',
            'Accountant',
            'Factory_Manager',
            'Station_Manager',
            'Project_Manager',
          ],
        }),
      ),
    ).toStrictEqual({
      accountant: true,
      director: true,
      'factory-manager': true,
      'station-manager': true,
      'project-manager': true,
    })
    expect(
      evaluateReviewedCorporationRolePredicates(
        sets({
          rolesAtBase: ['Director'],
          rolesAtHeadquarters: ['Accountant'],
          rolesAtOther: ['Factory_Manager'],
        }),
      ),
    ).toStrictEqual({
      accountant: false,
      director: false,
      'factory-manager': false,
      'station-manager': false,
      'project-manager': false,
    })
    expect(evaluateCorporationRolePredicate(sets({ roles: ['Director'] }), 'director')).toBe(true)
    expect(isReviewedCorporationRolePredicate('rolesAtBase')).toBe(false)
  })

  test('rotates the opaque revision only for semantic or binding changes', () => {
    let generated = 0
    const generateRevision = () => `revision-${++generated}`

    expect(
      resolveCorporationRoleRevision({
        currentRevision: 'current',
        generateRevision,
        transition: 'unchanged',
      }),
    ).toBe('current')
    expect(
      resolveCorporationRoleRevision({
        currentRevision: 'current',
        generateRevision,
        transition: 'lost',
      }),
    ).toBe('revision-1')
    expect(
      resolveCorporationRoleRevision({
        currentRevision: null,
        generateRevision,
        transition: 'initial',
      }),
    ).toBe('revision-2')
  })
})
