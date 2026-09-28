import { describe, expect, test } from 'vitest'
import { presentReviewerUseDisclosures } from '../../src/reviewer-use-disclosure.js'

describe('Member Audit reviewer-use disclosures', () => {
  test('states the independent current snapshots and their readable and purge limits', () => {
    const [presentation] = presentReviewerUseDisclosures([
      { disclosureVersion: 1, moduleId: 'member-audit', sectionId: 'current-observation' },
    ])

    expect(presentation?.fields).toContain('separate validation times and upstream expiries')
    expect(presentation?.fields).toContain('No ship instance ID, coordinates, or movement history')
    expect(presentation?.purpose).toContain('Authorized organization reviewers')
    expect(presentation?.retention).toContain(
      'at most 24 hours after its own successful validation',
    )
    expect(presentation?.retention).toContain('only until earlier upstream expiry')
    expect(presentation?.retention).toContain('permits no stale observation evidence')
    expect(presentation?.retention).toContain('purged within 24 hours of invalidation')
    expect(presentation?.retention).toContain('purged within 24 hours after expiry')
  })

  test('does not disclose skill queue collection as part of trained skills', () => {
    const [presentation] = presentReviewerUseDisclosures([
      { disclosureVersion: 2, moduleId: 'member-audit', sectionId: 'skills' },
    ])

    expect(`${presentation?.title} ${presentation?.fields} ${presentation?.retention}`).not.toMatch(
      /queue|queued/i,
    )
  })
})
