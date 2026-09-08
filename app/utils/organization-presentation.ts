export const organizationComplianceLabels = {
  pending: 'Registration pending',
  compliant: 'Compliant',
  review_required: 'Review required',
  suspended: 'Access suspended',
} as const

export const organizationComplianceDescriptions = {
  pending: 'Registration evidence is incomplete. Organization entitlements have not been granted.',
  compliant: 'Fresh evidence confirms every attached character satisfies the registration policy.',
  review_required: 'A verified registration issue requires action before the review period ends.',
  suspended:
    'Organization entitlements are suspended. Authentication and remediation remain available.',
} as const

export function organizationComplianceDescription(
  state: keyof typeof organizationComplianceDescriptions,
  evidenceFreshness: 'fresh' | 'stale' | 'unavailable',
) {
  if (state !== 'compliant' || evidenceFreshness === 'fresh')
    return organizationComplianceDescriptions[state]
  if (evidenceFreshness === 'stale')
    return 'The last verified compliant result is retained during bounded stale-evidence grace. Current affiliation has not been confirmed.'
  return 'The last compliant result is visible, but current registration evidence is unavailable.'
}

const organizationReasonLabels: Record<string, string> = {
  'no-attached-characters': 'No characters are attached',
  'managed-corporation-evidence-unavailable': 'Managed-organization evidence is unavailable',
  'no-managed-organization-character': 'No attached character belongs to the managed organization',
  'character-affiliation-unavailable': 'Character affiliation is unavailable',
  'character-affiliation-stale': 'Character affiliation is stale',
  'character-outside-managed-organization': 'Character is outside the managed organization',
  'character-authorization-missing': 'Character authorization is missing',
  'required-scope-missing': 'Required EVE authorization scope is missing',
}

const organizationRemediationLabels: Record<string, string> = {
  'attach-character': 'Attach a character',
  'attach-managed-character': 'Attach an organization character',
  'reauthorize-character': 'Reauthorize character',
  'await-affiliation-refresh': 'Await affiliation refresh',
  'contact-organization-hr': 'Contact organization HR',
}

export function formatOrganizationTimestamp(timestamp: string | null) {
  if (!timestamp) return 'Not recorded'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp))
}

export function organizationReasonLabel(code: string) {
  return organizationReasonLabels[code] ?? code.replaceAll('-', ' ')
}

export function organizationRemediationLabel(type: string) {
  return organizationRemediationLabels[type] ?? type.replaceAll('-', ' ')
}

export function organizationRemediationHref(apiBase: string, path: string | null) {
  return path ? new URL(path, apiBase).toString() : null
}
