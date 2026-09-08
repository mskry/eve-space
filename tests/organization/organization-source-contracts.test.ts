import { describe, expect, it } from 'vitest'
import { readWorkspaceFile } from '../support/read-workspace-file'

describe('organization frontend source contracts', () => {
  it('keeps deployment administration separate and identifies the EVE authority character', () => {
    const component = readWorkspaceFile('app/components/settings/SettingsIntegrations.vue')

    expect(component).toContain('Separate security boundary')
    expect(component).toContain('It does not grant organization')
    expect(component).toContain('Authority supplied by')
    expect(component).toContain('claim-organization-owner')
    expect(component).toContain('authorityContext?.isOrganizationOwner')
  })

  it('keeps protected organization reads client-gated', () => {
    const composable = readWorkspaceFile('app/composables/useOrganizationAuthority.ts')

    expect(composable).toContain('adminSetupQuery(apiClient)')
    expect(composable).toContain('deploymentConfigured.value === true')
    expect(composable).toContain('contextQuery.data.value?.isOrganizationOwner === true')
    expect(composable).toContain('rolesQuery.error.value')
  })

  it('presents unconfigured deployments without loading organization authority', () => {
    const component = readWorkspaceFile('app/components/settings/SettingsIntegrations.vue')

    expect(component).toContain('!loading && deploymentConfigured === false')
    expect(component).toContain('Deployment organization is not configured.')
  })

  it('presents per-corporation source, freshness, and unregistered observations', () => {
    const component = readWorkspaceFile('app/components/settings/SettingsRosterCoverage.vue')
    const composable = readWorkspaceFile('app/composables/useOrganizationRosterCoverage.ts')

    expect(component).toContain('Coverage compares observed corporation rosters')
    expect(component).toContain('corporation.source?.characterId')
    expect(component).toContain('corporation.unregisteredCharacters')
    expect(composable).toContain('import.meta.client')
    expect(composable).toContain('capabilities.viewRosterCoverage === true')
  })

  it('keeps HR exception and audit reads behind current review capability', () => {
    const component = readWorkspaceFile('app/components/settings/SettingsOrganizationHrReview.vue')
    const composable = readWorkspaceFile('app/composables/useOrganizationHrReview.ts')

    expect(component).toContain('External-character exceptions')
    expect(component).toContain('Awaiting exception review')
    expect(component).toContain('reviewCandidates')
    expect(component).toContain('Decision history')
    expect(component).toContain('event.actorId')
    expect(component).toContain('event.subjectId')
    expect(composable).toContain('import.meta.client && canReview.value')
    expect(composable).toContain('memberAccess === true')
    expect(composable).toContain('capabilities.reviewRegistration')
    expect(composable).toContain('adminSetupQuery(apiClient)')
  })

  it('stacks HR review controls and audit rows for mobile layouts', () => {
    const responsive = readWorkspaceFile('app/assets/css/responsive.css')
    const page = readWorkspaceFile('app/pages/settings/roster-coverage.vue')

    expect(page).toContain('<SettingsOrganizationHrReview />')
    expect(page).toContain('<SettingsRosterCoverage />')
    expect(responsive).toContain('.hr-review-row--decision')
    expect(responsive).toContain('.hr-audit-list li')
    expect(responsive).toContain('.hr-candidate-form')
    expect(responsive).toContain('grid-template-columns: 1fr')
  })

  it('clears the revocation reason whenever the form opens or closes', () => {
    const component = readWorkspaceFile('app/components/settings/SettingsIntegrations.vue')

    expect(component).toContain('@click="openRevocation(grant.grantId)"')
    expect(component).toContain('@click="closeRevocation"')
    expect(component.match(/revokeReason\.value = ''/g)).toHaveLength(2)
  })
})
