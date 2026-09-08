import { describe, expect, it } from 'vitest'
import {
  formatOrganizationTimestamp,
  organizationComplianceDescription,
  organizationComplianceDescriptions,
  organizationComplianceLabels,
  organizationReasonLabel,
  organizationRemediationHref,
  organizationRemediationLabel,
} from '../../app/utils/organization-presentation'

describe('organization presentation', () => {
  it('presents each compliance state and evidence freshness', () => {
    expect(organizationComplianceLabels).toEqual({
      pending: 'Registration pending',
      compliant: 'Compliant',
      review_required: 'Review required',
      suspended: 'Access suspended',
    })
    expect(organizationComplianceDescription('pending', 'unavailable')).toBe(
      organizationComplianceDescriptions.pending,
    )
    expect(organizationComplianceDescription('compliant', 'fresh')).toBe(
      organizationComplianceDescriptions.compliant,
    )
    expect(organizationComplianceDescription('compliant', 'stale')).toContain(
      'bounded stale-evidence grace',
    )
    expect(organizationComplianceDescription('compliant', 'unavailable')).toContain(
      'current registration evidence is unavailable',
    )
  })

  it('formats recorded and missing timestamps in UTC', () => {
    expect(formatOrganizationTimestamp(null)).toBe('Not recorded')
    expect(formatOrganizationTimestamp('2026-09-08T10:30:00.000Z')).toBe('8 Sept 2026, 10:30')
  })

  it('labels known reasons and remediations with readable fallbacks', () => {
    expect(organizationReasonLabel('required-scope-missing')).toBe(
      'Required EVE authorization scope is missing',
    )
    expect(organizationReasonLabel('new-policy-reason')).toBe('new policy reason')
    expect(organizationRemediationLabel('reauthorize-character')).toBe('Reauthorize character')
    expect(organizationRemediationLabel('request-manual-review')).toBe('request manual review')
  })

  it('resolves remediation paths against the API origin', () => {
    expect(
      organizationRemediationHref('https://api.example.test/v1/', '/auth/eve/start?intent=attach'),
    ).toBe('https://api.example.test/auth/eve/start?intent=attach')
    expect(organizationRemediationHref('https://api.example.test/v1/', null)).toBeNull()
  })
})
